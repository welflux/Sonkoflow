import type { Express, Request, Response } from "express";
import { z } from "zod";
import sharp from "sharp";
import { AppError, uuid, hash } from "../security.js";
import type { ProcessingEngine } from "../processing/engine.js";
import type { Identity } from "../services.js";
import { jobFields, qualityFields } from "../processing/contracts.js";
import { publicTrialSettings } from '../processing/claid-trial.js';
export function libraryError(e: any) {
  if (!e) return;
  const name = [
    "library_not_found",
    "processing_image_busy",
    "library_expired",
    "project_not_empty",
    "library_invalid",
  ].find((k) => e.message?.includes(k));
  throw new AppError(
    name === "library_not_found" ? 404 : name ? 409 : 503,
    name ?? "library_unavailable",
    name === "processing_image_busy"
      ? "Wait for active generation or assessment before trashing these images."
      : name === "library_expired"
        ? "The 30-day recovery period has ended."
        : name === "project_not_empty"
          ? "This project still holds photographs or source records. Move or delete its images, or archive it."
          : name === "library_not_found"
            ? "An image or project was not found."
            : "Library operation could not be completed. Refresh or verify the migration.",
  );
}
const flag = z.preprocess((v) => v === "1" || v === true, z.boolean());
export const libraryQuery = z
  .object({
    search: z.string().trim().max(150).default(""),
    project_id: uuid.optional(),
    unassigned: flag.optional(),
    trash: flag.optional(),
    archived: flag.optional(),
    role: z.enum(["original", "generated"]).optional(),
    mode: z.enum(["personal", "portrait", "product"]).optional(),
    status: z
      .enum([
        "ready",
        "queued",
        "running",
        "persisting",
        "completed",
        "failed",
        "cancelled",
        "uncertain",
      ])
      .optional(),
    review: z.enum(["pending", "approved", "rejected"]).optional(),
    sort: z.enum(["newest", "oldest", "name"]).default("newest"),
    after: z.iso.datetime({ offset: true }).optional(),
    before: z.iso.datetime({ offset: true }).optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
export function libraryRoutes(
  app: Express,
  engine: ProcessingEngine,
  who: (res: Response) => Identity,
  limit: (r: Request, b: string, n?: number, s?: number) => Promise<void>,
) {
  app.get("/api/library/capabilities", async (_q, r) => {
    const v = await engine.admin.rpc("library_schema_version");
    r.json({
      available: !v.error && v.data === 2026102806,
      retention_days: 30,
    });
  });
  app.get("/api/library", async (q, r) => {
    const p = libraryQuery.parse(q.query),
      v = await engine.admin.rpc("library_query", { owner: who(r).userId, p });
    libraryError(v.error);
    r.json(v.data);
  });
  app.post("/api/library/actions", async (q, r) => {
    await limit(q, "library-write", 60);
    const b = z
      .object({
        ids: z.array(uuid).min(1).max(100),
        action: z.enum(["rename", "move", "trash", "restore"]),
        value: z.string().trim().max(150).nullable().optional(),
      })
      .strict()
      .parse(q.body);
    if (b.action === "rename" && !b.value)
      throw new AppError(400, "invalid_input", "Enter a filename.");
    if (b.action === "move" && b.value) uuid.parse(b.value);
    const v = await engine.admin.rpc("library_action", {
      owner: who(r).userId,
      ids: b.ids,
      action: b.action,
      value: b.value ?? null,
    });
    libraryError(v.error);
    r.json({ updated: v.data });
  });
  app.get("/api/library/projects", async (_q, r) => {
    const v = await who(r)
      .client.from("projects")
      .select("id,name,audience,archived,created_at")
      .order("name");
    libraryError(v.error);
    r.json({ projects: v.data ?? [] });
  });
  app.post("/api/library/projects/:id", async (q, r) => {
    await limit(q, "library-project", 30);
    const b = z
      .object({
        action: z.enum(["rename", "archive", "restore", "delete"]),
        value: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .parse(q.body);
    if (b.action === "rename" && !b.value)
      throw new AppError(400, "invalid_input", "Enter a project name.");
    const v = await engine.admin.rpc("library_project_action", {
      owner: who(r).userId,
      target: uuid.parse(q.params.id),
      action: b.action,
      value: b.value ?? null,
    });
    libraryError(v.error);
    if (!v.data) throw new AppError(404, "not_found", "Project not found.");
    r.json({ ok: true });
  });
  app.get("/api/library/:id/history", async (q, r) => {
    const id = uuid.parse(q.params.id),
      offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .default(0)
        .parse(q.query.offset),
      identity = who(r);
    const image = await identity.client
      .from("images")
      .select("id,project_id,library_project_id,filename")
      .eq("id", id)
      .maybeSingle();
    libraryError(image.error);
    if (!image.data) throw new AppError(404, "not_found", "Image not found.");
    const v = await identity.client
      .from("processing_jobs")
      .select(`${jobFields},${qualityFields},pack_id,library_project_id`)
      .or(`input_image_id.eq.${id},output_image_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .range(offset, offset + 23);
    libraryError(v.error);
    r.json({
      image: image.data,
      jobs: (v.data ?? []).map((j:any)=>({...j,settings:publicTrialSettings(j.settings)})),
      next_offset: v.data?.length === 24 ? offset + 24 : null,
    });
  });
  let busy = 0;
  const queue: { go: () => void; reject: () => void }[] = [];
  const acquire = async () => {
    if (busy < 2) {
      busy++;
      return;
    }
    if (queue.length >= 24)
      throw new AppError(
        503,
        "thumbnail_busy",
        "Thumbnail service is busy. Retry shortly.",
      );
    await new Promise<void>((resolve, reject) => {
      const item = {
        go: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: () =>
          reject(
            new AppError(503, "thumbnail_busy", "Thumbnail service is busy."),
          ),
      };
      const timer = setTimeout(() => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        item.reject();
      }, 15000);
      queue.push(item);
    });
  };
  const release = () => {
    const next = queue.shift();
    if (next) next.go();
    else busy--;
  };
  app.get("/api/library/:id/thumbnail", async (q, r) => {
    await limit(q, "library-thumb", 200, 300);
    const id = uuid.parse(q.params.id),
      v = await who(r)
        .client.from("images")
        .select("id,object_key,checksum,status")
        .eq("id", id)
        .eq("status", "ready")
        .maybeSingle();
    libraryError(v.error);
    if (!v.data) throw new AppError(404, "not_found", "Image not found.");
    await acquire();
    try {
      const d = await engine.admin.storage
        .from("photos")
        .download(v.data.object_key);
      if (d.error || !d.data || d.data.size > 10485760)
        throw new AppError(
          503,
          "thumbnail_storage",
          "Thumbnail retrieval failed.",
        );
      const b = Buffer.from(await d.data.arrayBuffer());
      if (hash(b) !== v.data.checksum)
        throw new AppError(
          503,
          "thumbnail_storage",
          "Image verification failed.",
        );
      const thumbnail = await sharp(b, {
        limitInputPixels: 25000000,
        failOn: "warning",
      })
        .resize({
          width: 480,
          height: 480,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 70 })
        .toBuffer();
      r.type("webp").set("Cache-Control", "private, no-store").send(thumbnail);
    } finally {
      release();
    }
  });
}
