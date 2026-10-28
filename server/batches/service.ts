import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, hash } from "../security.js";
import { packInput, requestFingerprint } from "../packs/contracts.js";
import { PackService, packProgress, fields } from "../packs/service.js";
import { makePackPlan } from "../packs/plan.js";
import { BrandService } from "../brand/service.js";
import { limits } from "../processing/config.js";
import { processingDbError } from "../processing/contracts.js";
import type { ProcessingEngine } from "../processing/engine.js";
import type { Identity } from "../services.js";
export const batchInput = packInput
  .omit({ input_image_id: true })
  .extend({
    name: z.string().trim().min(1).max(100),
    image_ids: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict();
export function batchConfig(env: NodeJS.ProcessEnv = process.env) {
  return z
    .object({
      AI_BATCH_FILE_BYTES: z.coerce
        .number()
        .int()
        .min(65536)
        .max(10485760)
        .default(10485760),
      AI_BATCH_FORMATS: z.preprocess(
        (v) => (typeof v === "string" ? v.split(",") : v),
        z
          .array(z.enum(["image/jpeg", "image/png", "image/webp"]))
          .min(1)
          .default(["image/jpeg", "image/png", "image/webp"]),
      ),
      AI_BATCH_MAX_IMAGES: z.coerce.number().int().min(1).max(100).default(5),
      AI_BATCH_MAX_BYTES: z.coerce
        .number()
        .int()
        .min(1048576)
        .max(1048576000)
        .default(52428800),
      AI_BATCH_DAILY_LIMIT: z.coerce.number().int().min(1).max(20).default(2),
    })
    .parse(env);
}
export function batchProgress(items: any[]) {
  const counts = {
    total: items.length,
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const item of items) {
    const p = item.progress;
    if (p.completed === p.total && !p.pending && !p.reviewing)
      counts.completed++;
    else if (
      p.pending === p.total &&
      item.outputs.every((o: any) => o.current?.status === "queued")
    )
      counts.queued++;
    else if (p.pending || p.reviewing) counts.processing++;
    else if (item.outputs.every((o: any) => o.current?.status === "cancelled"))
      counts.cancelled++;
    else counts.failed++;
  }
  return {
    counts,
    status: !items.length
      ? "incomplete"
      : counts.processing
        ? "processing"
        : counts.queued
          ? "queued"
          : counts.completed === counts.total
            ? "completed"
            : counts.cancelled === counts.total
              ? "cancelled"
              : counts.completed
                ? "partially_completed"
                : "failed",
  };
}
export function batchDb(e: any) {
  if (e?.message?.includes("batch_limit"))
    throw new AppError(
      409,
      "batch_limit",
      "The batch size, daily or active-batch limit has been reached.",
    );
  processingDbError(e);
}
export class BatchService {
  readonly packs: PackService;
  readonly config;
  constructor(
    readonly engine: ProcessingEngine,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.packs = new PackService(engine);
    this.config = batchConfig(env);
  }
  async ready() {
    const r = await this.engine.admin.rpc("batch_schema_version");
    return !r.error && r.data === 2026102805;
  }
  async require() {
    if (!(await this.ready()))
      throw new AppError(
        503,
        "batch_migration",
        "Bulk processing requires its database migration.",
      );
    return this.packs.configured();
  }
  async plan(raw: unknown, identity: Identity) {
    const input = batchInput.parse(raw),
      { c, pc } = await this.require();
    if (input.image_ids.length > this.config.AI_BATCH_MAX_IMAGES)
      throw new AppError(400, "batch_limit", "Choose fewer source images.");
    const brand = await new BrandService(this.engine.admin).resolve(
      input.brand,
      identity,
    );
    let totalBytes = 0;
    const plans = [];
    for (const id of input.image_ids) {
      const p = packInput.parse(
        Object.fromEntries(
          Object.entries({ ...input, input_image_id: id }).filter(
            ([k]) => !["name", "image_ids"].includes(k),
          ),
        ),
      );
      const source = await this.packs.source(p, identity);
      const bytes = await identity.client
        .from("images")
        .select("byte_size")
        .eq("id", id)
        .single();
      batchDb(bytes.error);
      totalBytes += bytes.data?.byte_size ?? 0;
      plans.push({
        input: p,
        plan: makePackPlan(
          p,
          source,
          c,
          this.engine.quality.vision,
          pc,
          this.engine.quality.retryLimit,
          brand,
        ),
      });
    }
    if (totalBytes > this.config.AI_BATCH_MAX_BYTES)
      throw new AppError(
        400,
        "batch_limit",
        "The combined normalized images exceed the batch byte limit.",
      );
    const reserved = plans.reduce((n, p) => n + p.plan.reserved_credits, 0),
      estimated = plans.reduce((n, p) => n + p.plan.estimated_credits, 0);
    return {
      input,
      plans,
      reserved,
      estimated,
      fingerprint: hash(JSON.stringify(plans)),
    };
  }
  async quote(raw: unknown, i: Identity) {
    const p = await this.plan(raw, i),
      allowance = await this.packs.allowance(i, true);
    return {
      quote_fingerprint: p.fingerprint,
      estimated_credits: p.estimated,
      reserved_credits: p.reserved,
      allowance,
      can_generate: allowance.available_credits >= p.reserved,
      images: p.plans.length,
      outputs: p.plans.reduce((n, p) => n + p.plan.outputs.length, 0),
    };
  }
  async create(raw: unknown, i: Identity) {
    const b = batchInput
      .extend({
        submission_key: z.uuid(),
        quote_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        provider_consent: z.literal(true),
      })
      .parse(raw);
    const input = batchInput.parse(
        Object.fromEntries(
          Object.entries(b).filter(
            ([k]) =>
              ![
                "submission_key",
                "quote_fingerprint",
                "provider_consent",
              ].includes(k),
          ),
        ),
      ),
      fingerprint = hash(JSON.stringify(input));
    const prior = await i.client
      .from("processing_batches")
      .select("id,request_fingerprint")
      .eq("submission_key", b.submission_key)
      .maybeSingle();
    batchDb(prior.error);
    if (prior.data) {
      if (prior.data.request_fingerprint !== fingerprint)
        throw new AppError(
          409,
          "submission_conflict",
          "This submission belongs to another batch.",
        );
      return prior.data.id;
    }
    const p = await this.plan(input, i);
    if (p.fingerprint !== b.quote_fingerprint)
      throw new AppError(
        409,
        "pack_quote_stale",
        "Review a fresh batch estimate.",
      );
    const c = this.engine.config!,
      pc = this.engine.packConfig!;
    const r = await this.engine.admin.rpc("create_processing_batch", {
      p: {
        user_id: i.userId,
        project_id: input.project_id,
        name: input.name,
        submission_key: b.submission_key,
        request_fingerprint: fingerprint,
        configuration: {
          ...input,
          brand_snapshot:
            p.plans[0].plan.outputs[0].job.settings.brand_snapshot ?? null,
        },
        plan: { reserved_credits: p.reserved, estimated_credits: p.estimated },
      },
      items: p.plans.map((o) => ({
        input_image_id: o.input.input_image_id,
        configuration: o.input,
        jobs: o.plan.outputs.map((v) => ({
          ...v.job,
          submission_key: randomUUID(),
          request_fingerprint: hash(
            `${fingerprint}:${o.input.input_image_id}:${v.type}`,
          ),
          acknowledge_uncertain: input.acknowledge_uncertain,
        })),
      })),
      limits: limits(c),
      pack_limits: {
        max_outputs: pc.AI_PACK_MAX_OUTPUTS,
        initial_credits: pc.AI_PACK_INITIAL_CREDITS,
        unit_micro_usd: pc.AI_PACK_CREDIT_MICRO_USD,
      },
      batch_limits: {
        max_images: this.config.AI_BATCH_MAX_IMAGES,
        daily: this.config.AI_BATCH_DAILY_LIMIT,
        max_bytes: this.config.AI_BATCH_MAX_BYTES,
      },
    });
    batchDb(r.error);
    await this.engine.start();
    return r.data.id;
  }
  async get(id: string, i: Identity) {
    const r = await i.client
      .from("processing_batches")
      .select(
        "id,name,project_id,configuration,plan,cancel_requested,created_at",
      )
      .eq("id", id)
      .maybeSingle();
    batchDb(r.error);
    if (!r.data) throw new AppError(404, "not_found", "Batch not found.");
    const rows = await i.client
      .from("batch_items")
      .select("pack_id,input_image_id,position")
      .eq("batch_id", id)
      .order("position");
    batchDb(rows.error);
    const ids = (rows.data ?? []).map((row) => row.pack_id);
    const packs = ids.length
      ? await i.client
          .from("product_packs")
          .select("id,project_id,input_image_id,configuration,plan,created_at")
          .in("id", ids)
      : { data: [], error: null };
    batchDb(packs.error);
    const jobs = ids.length
      ? await i.client
          .from("processing_jobs")
          .select(fields)
          .in("pack_id", ids)
          .order("created_at", { ascending: true })
          .range(0, 2999)
      : { data: [], error: null };
    batchDb(jobs.error);
    const items = (rows.data ?? []).map((row) => {
      const pack = packs.data?.find((p) => p.id === row.pack_id);
      if (!pack)
        throw new AppError(
          503,
          "batch_integrity",
          "A saved batch item is unavailable.",
        );
      return {
        ...row,
        pack,
        ...packProgress(
          pack,
          (jobs.data ?? []).filter((j: any) => j.pack_id === row.pack_id),
        ),
      };
    });
    return { batch: r.data, items, ...batchProgress(items) };
  }
}
