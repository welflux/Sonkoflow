import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { Identity } from "../services.js";
import type { ProcessingEngine } from "../processing/engine.js";
import { AppError, hash, uuid } from "../security.js";
import { BrandService } from "./service.js";
import { brandDb, brandSelection } from "./contracts.js";
import { validateAsset } from "./assets.js";
export function brandRoutes(
  app: Express,
  engine: ProcessingEngine,
  who: (r: Response) => Identity,
  limit: (
    req: Request,
    bucket: string,
    max?: number,
    seconds?: number,
  ) => Promise<void>,
) {
  const svc = new BrandService(engine.admin);
  let uploads = 0;
  app.get("/api/brands/capabilities", async (_q, r) =>
    r.json({
      available: await svc.ready(),
      asset_types: ["image/png", "image/jpeg", "image/webp"],
      max_profiles: 20,
      max_assets: 50,
    }),
  );
  app.get("/api/brands", async (_q, r) =>
    r.json({ profiles: await svc.list(who(r)) }),
  );
  app.post("/api/brands/preview", async (q, r) =>
    r.json({
      snapshot: await svc.resolve(brandSelection.parse(q.body), who(r)),
    }),
  );
  app.get("/api/brands/assets", async (_q, r) => {
    await svc.require();
    const v = await who(r)
      .client.from("brand_assets")
      .select("id,name,kind,width,height,byte_size,status")
      .eq("status", "ready")
      .order("created_at", { ascending: false });
    brandDb(v.error);
    r.json({ assets: v.data ?? [] });
  });
  app.get("/api/brands/assets/:id/content", async (q, r) =>
    r
      .type("webp")
      .set("Cache-Control", "no-store")
      .send(await svc.content(uuid.parse(q.params.id), who(r))),
  );
  app.delete("/api/brands/assets/:id", async (q, r) => {
    const id = uuid.parse(q.params.id);
    await svc.asset(id, who(r));
    const v = await engine.admin
      .from("brand_assets")
      .update({ status: "deleted" })
      .eq("id", id)
      .eq("user_id", who(r).userId)
      .eq("status", "ready");
    brandDb(v.error);
    r.json({ deleted: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 4, parts: 5 },
  }).single("asset");
  app.post(
    "/api/brands/assets",
    async (q, r, next) => {
      try {
        await limit(q, "brand-upload", 20, 900);
        await svc.require();
        if (uploads >= 2)
          throw new AppError(
            503,
            "brand_busy",
            "An asset is being prepared. Try again shortly.",
          );
        uploads++;
        let freed = false;
        const free = () => {
          if (!freed) {
            freed = true;
            uploads--;
          }
        };
        r.once("finish", free);
        r.once("close", free);
        upload(q, r, (e) => {
          if (e) {
            free();
            next(e);
          } else next();
        });
      } catch (e) {
        next(e);
      }
    },
    async (q, r) => {
      if (!q.file)
        throw new AppError(400, "brand_asset_invalid", "Choose a brand asset.");
      const b = z
          .object({
            id: uuid,
            name: z.string().trim().min(1).max(100),
            kind: z.enum(["logo", "reference"]),
          })
          .strict()
          .parse(q.body),
        a = await validateAsset(q.file.buffer, q.file.mimetype),
        owner = who(r).userId;
      const p = await engine.admin.rpc("reserve_brand_asset", {
        owner,
        target: b.id,
        p: { ...b, ...a, bytes: undefined },
      });
      brandDb(p.error);
      if (p.data.status === "ready") return r.json({ asset: { id: b.id } });
      if (p.data.status !== "pending")
        throw new AppError(
          409,
          "brand_conflict",
          "This asset identifier was already removed or failed. Choose the file again.",
        );
      try {
        await engine.admin.storage
          .from("photos")
          .upload(p.data.object_key, a.bytes, {
            contentType: "image/webp",
            upsert: false,
          });
        const stored = await engine.admin.storage
          .from("photos")
          .download(p.data.object_key);
        if (
          stored.error ||
          !stored.data ||
          stored.data.size > 2 * 1024 * 1024 ||
          hash(Buffer.from(await stored.data.arrayBuffer())) !== a.checksum
        )
          throw Error();
        const done = await engine.admin
          .from("brand_assets")
          .update({ status: "ready" })
          .eq("id", b.id)
          .eq("user_id", owner)
          .eq("status", "pending")
          .select("id")
          .single();
        brandDb(done.error);
        r.status(201).json({ asset: { id: b.id } });
      } catch {
        throw new AppError(
          503,
          "brand_storage",
          "Asset storage could not be verified. Retry the same upload; it will not create a duplicate.",
        );
      }
    },
  );
  const mutation = z
    .object({
      id: uuid,
      revision: z.number().int().positive().nullable().default(null),
      action: z.enum(["save", "delete", "duplicate"]).default("save"),
      parent: uuid.nullable().default(null),
      data: z.unknown().optional(),
    })
    .strict();
  app.post("/api/brands", async (q, r) => {
    await limit(q, "brand-write", 60, 900);
    const b = mutation.parse(q.body);
    r.json({
      profile: await svc.mutate(
        "profile",
        b.action,
        b.id,
        b.parent,
        b.revision,
        b.data,
        who(r),
      ),
    });
  });
  app.get("/api/brands/:id", async (q, r) => {
    const id = uuid.parse(q.params.id);
    r.json({
      profile: await svc.get(id, who(r)),
      presets: await svc.presets(id, who(r)),
    });
  });
  app.post("/api/brands/:id/presets", async (q, r) => {
    await limit(q, "brand-write", 60, 900);
    const b = mutation.omit({ parent: true }).parse(q.body);
    if (b.action === "duplicate")
      throw new AppError(400, "brand_action", "Save a copy as a new preset.");
    r.json({
      preset: await svc.mutate(
        "preset",
        b.action,
        b.id,
        uuid.parse(q.params.id),
        b.revision,
        b.data,
        who(r),
      ),
    });
  });
}
