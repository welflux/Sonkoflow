import type { Express, Response, Request } from "express";
import { z } from "zod";
import type { Identity } from "../services.js";
import { uuid, AppError } from "../security.js";
import type { ProcessingEngine } from "../processing/engine.js";
import { processingDbError } from "../processing/contracts.js";
import { PackService, fields } from "./service.js";
import { outputSpecs, packDbError } from "./contracts.js";
import { retryRequest } from "../quality/contracts.js";
export function packRoutes(
  app: Express,
  engine: ProcessingEngine,
  who: (res: Response) => Identity,
  rateLimit?: (
    req: Request,
    bucket: string,
    max: number,
    seconds: number,
  ) => Promise<void>,
) {
  let archives = 0;
  const service = new PackService(engine);
  app.get("/api/packs/capabilities", async (_req, res) => {
    const history = await engine.packsReady();
    const tier = engine.billing
      ? (await engine.billing.account(who(res))).plan
      : null;
    const maxQuality = ["starter", "payg"].includes(tier)
      ? "medium"
      : engine.config?.AI_MAX_QUALITY;
    res.json({
      enabled:
        history && !!engine.config && !!engine.packConfig && tier !== "free",
      reason:
        tier === "free"
          ? "Product packs require a paid allowance. Compare plans to continue."
          : null,
      history_available: history,
      outputs: outputSpecs,
      max_outputs: engine.packConfig?.AI_PACK_MAX_OUTPUTS ?? 0,
      qualities: engine.config
        ? ["low", "medium", "high"].slice(
            0,
            Math.min(
              ["low", "medium", "high"].indexOf(engine.config.AI_MAX_QUALITY),
              ["low", "medium", "high"].indexOf(maxQuality ?? "high"),
            ) + 1,
          )
        : [],
      default_quality: ["low", "medium", "high"][
        Math.min(
          ["low", "medium", "high"].indexOf(
            engine.config?.AI_MAX_QUALITY ?? "high",
          ),
          ["low", "medium", "high"].indexOf(maxQuality ?? "high"),
        )
      ],
    });
  });
  app.post("/api/packs/quote", async (req, res) =>
    res.json(await service.quote(req.body, who(res))),
  );
  app.post("/api/packs", async (req, res) =>
    res.status(202).json({ pack: await service.create(req.body, who(res)) }),
  );
  app.get("/api/packs", async (req, res) => {
    const p = z
      .object({
        project_id: uuid,
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .strict()
      .parse(req.query);
    if (!(await engine.packsReady()))
      return res.json({ packs: [], next_offset: null });
    const r = await who(res)
      .client.from("product_packs")
      .select("id,configuration,created_at,plan")
      .eq("project_id", p.project_id)
      .order("created_at", { ascending: false })
      .range(p.offset, p.offset + 19);
    processingDbError(r.error);
    res.json({
      packs: r.data ?? [],
      next_offset: r.data?.length === 20 ? p.offset + 20 : null,
    });
  });
  app.get("/api/packs/:id", async (req, res) =>
    res.json(await service.get(uuid.parse(req.params.id), who(res))),
  );
  app.get("/api/packs/:id/download", async (req, res) => {
    await rateLimit?.(req, `pack-zip:${who(res).userId}`, 5, 300);
    if (archives >= (engine.packConfig?.AI_PACK_ZIP_CONCURRENCY ?? 1))
      throw new AppError(
        503,
        "archive_busy",
        "An archive is being prepared. Try again shortly.",
      );
    archives++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        archives--;
      }
    };
    res.once("finish", release);
    res.once("close", release);
    try {
      const id = uuid.parse(req.params.id),
        zip = await service.zip(id, who(res));
      res
        .set({
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="sonkoflow-pack-${id.slice(0, 8)}.zip"`,
          "Cache-Control": "no-store",
        })
        .send(zip);
    } catch (error) {
      release();
      throw error;
    }
  });
  app.post("/api/packs/outputs/:id/retry-plan", async (req, res) => {
    const id = uuid.parse(req.params.id),
      body = retryRequest
        .omit({
          provider_consent: true,
          submission_key: true,
          quote_fingerprint: true,
        })
        .parse(req.body),
      identity = who(res);
    await service.configured();
    const r = await identity.client
      .from("processing_jobs")
      .select(fields)
      .eq("id", id)
      .maybeSingle();
    processingDbError(r.error);
    if (!r.data || !r.data.pack_id)
      throw new AppError(404, "not_found", "Pack output not found.");
    const source = await identity.client
      .from("images")
      .select("width,height,role,status")
      .eq("id", r.data.input_image_id)
      .eq("project_id", r.data.project_id)
      .maybeSingle();
    processingDbError(source.error);
    if (
      !source.data ||
      source.data.role !== "original" ||
      source.data.status !== "ready"
    )
      throw new AppError(
        404,
        "not_found",
        "Original product photograph not found.",
      );
    if (
      source.data.width * source.data.height >
      engine.packConfig!.AI_PACK_TOKEN_ESTIMATES_JSON.max_source_pixels
    )
      throw new AppError(
        503,
        "pack_estimates_required",
        "This source is outside the configured pack estimate range.",
      );
    const plan = engine.makePackRetryPlan(
        r.data,
        body.targets,
        body.instructions,
      ),
      allowance = await service.allowance(identity, true);
    res.json({
      quote_fingerprint: plan.fingerprint,
      reserved_credits: plan.plan.reserved_credits,
      estimated_credits: plan.plan.estimated_credits,
      allowance,
      can_generate: allowance.available_credits >= plan.plan.reserved_credits,
    });
  });
}
