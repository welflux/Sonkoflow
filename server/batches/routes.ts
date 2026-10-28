import type { Express, Response, Request } from "express";
import { z } from "zod";
import { BatchService, batchDb } from "./service.js";
import type { ProcessingEngine } from "../processing/engine.js";
import type { Identity } from "../services.js";
import { uuid, AppError } from "../security.js";
import { imageZip } from "../packs/zip.js";
export function batchRoutes(
  app: Express,
  engine: ProcessingEngine,
  who: (res: Response) => Identity,
  limit: (q: Request, b: string, n?: number, s?: number) => Promise<void>,
) {
  const service = new BatchService(engine);
  let archives = 0;
  app.get("/api/batches/capabilities", async (_q, r) =>
    r.json({
      available: await service.ready(),
      max_images: service.config.AI_BATCH_MAX_IMAGES,
      max_bytes: service.config.AI_BATCH_MAX_BYTES,
      file_bytes: service.config.AI_BATCH_FILE_BYTES,
      formats: service.config.AI_BATCH_FORMATS,
    }),
  );
  app.post("/api/batches/quote", async (q, r) => {
    await limit(q, "batch-quote", 20);
    r.json(await service.quote(q.body, who(r)));
  });
  app.post("/api/batches", async (q, r) => {
    await limit(q, "batch-create", 10);
    r.status(202).json({ id: await service.create(q.body, who(r)) });
  });
  app.get("/api/batches", async (q, r) => {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .default(0)
      .parse(q.query.offset);
    const result = await who(r)
      .client.from("processing_batches")
      .select("id,name,project_id,created_at,cancel_requested")
      .order("created_at", { ascending: false })
      .range(offset, offset + 19);
    batchDb(result.error);
    r.json({
      batches: result.data ?? [],
      next_offset: result.data?.length === 20 ? offset + 20 : null,
    });
  });
  app.get("/api/batches/:id", async (q, r) =>
    r.json(await service.get(uuid.parse(q.params.id), who(r))),
  );
  app.post("/api/batches/:id/cancel", async (q, r) => {
    await limit(q, "batch-cancel", 20);
    const b = await engine.admin.rpc("cancel_processing_batch", {
      target: uuid.parse(q.params.id),
      owner: who(r).userId,
    });
    batchDb(b.error);
    if (!b.data) throw new AppError(404, "not_found", "Batch not found.");
    r.json({ cancel_requested: true });
  });
  app.get("/api/batches/:id/download", async (q, r) => {
    await limit(q, "batch-zip", 5, 300);
    if (archives)
      throw new AppError(503, "archive_busy", "An archive is being prepared.");
    archives++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        archives--;
      }
    };
    r.once("finish", release);
    r.once("close", release);
    try {
      const b = await service.get(uuid.parse(q.params.id), who(r));
      const selected = q.query.packs
        ? z
            .string()
            .transform((s) => s.split(","))
            .pipe(z.array(uuid).min(1).max(100))
            .parse(q.query.packs)
        : b.items.filter((i) => i.progress.approved).map((i) => i.pack_id);
      if (
        new Set(selected).size !== selected.length ||
        selected.some((id) => !b.items.some((i) => i.pack_id === id))
      )
        throw new AppError(404, "not_found", "Selected batch items not found.");
      const files = [];
      let bytes = 0;
      for (const id of selected) {
        for (const f of await service.packs.zipFiles(id, who(r))) {
          bytes += f.bytes.length;
          if (bytes > 50 * 1024 * 1024)
            throw new AppError(
              413,
              "archive_limit",
              "Select fewer batch items; the archive limit is 50 MB.",
            );
          files.push({ ...f, name: `${id.slice(0, 8)}-${f.name}` });
        }
      }
      if (!files.length)
        throw new AppError(
          409,
          "no_approved_outputs",
          "Approve a completed result first.",
        );
      const latest = await service.get(uuid.parse(q.params.id), who(r));
      const signature = (value: any) =>
        JSON.stringify(
          value.items
            .filter((i: any) => selected.includes(i.pack_id))
            .map((i: any) => ({
              id: i.pack_id,
              outputs: i.outputs.map((o: any) => [
                o.approved?.id ?? null,
                o.approved?.decision_revision ?? null,
              ]),
            })),
        );
      if (signature(b) !== signature(latest))
        throw new AppError(
          409,
          "batch_changed",
          "Review decisions changed during archive preparation. Refresh and retry.",
        );
      const archive = imageZip(files, 100);
      r.type("application/zip")
        .set({
          "Cache-Control": "no-store",
          "Content-Disposition": 'attachment; filename="sonkoflow-batch.zip"',
        })
        .send(archive);
    } finally {
      if (!r.writableEnded) release();
    }
  });
}
