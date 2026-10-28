import {BillingService} from '../billing/service.js';
import {meterPlan} from '../billing/meter.js';
import { BrandService } from "../brand/service.js";
import { compositeBrand } from "../brand/assets.js";
import type { BrandSnapshot } from "../brand/contracts.js";
import { loadPackConfig } from "../packs/config.js";
import { makeOutputPlan } from "../packs/plan.js";
import { packType, type PackContext } from "../packs/contracts.js";
import { randomUUID } from "node:crypto";
import { QualityWorker, qualityStore } from "../quality/worker.js";
import { qualityConfig, visionPrice } from "../quality/config.js";
import {
  productOptions,
  retryDirection,
  type ProductOptions,
  type CheckId,
} from "../quality/contracts.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, hash } from "../security.js";
import type { Identity } from "../services.js";
import {
  loadProcessingConfig,
  limits,
  priceSnapshot,
  type ProcessingConfig,
} from "./config.js";
import {
  PROMPT_VERSION,
  PRODUCT_PROMPT_VERSION,
  fingerprint,
  outputSize,
  processingDbError,
  type JobInput,
} from "./contracts.js";
import {
  editImage,
  estimateCost,
  validateOutput,
  ProviderFailure,
  type ProviderResult,
} from "./provider.js";

export type WorkerJob = {
  id: string;
  user_id: string;
  project_id: string;
  input_image_id: string;
  submission_key: string;
  mode: JobInput["mode"];
  instructions: string;
  quality: JobInput["quality"];
  settings: {
    background: JobInput["background"];
    framing: JobInput["framing"];
    preserve_appearance: true;
    product_options?: ProductOptions;
    provider_consent?: boolean;
    pack_context?: PackContext;
    brand_snapshot?: BrandSnapshot;
  };
  quality_retry_targets?: CheckId[];
  quality_retry_instructions?: string;
  model: ProcessingConfig["AI_IMAGE_MODEL"];
  output_size: string;
  result_image_id: string;
  output_image_id: string | null;
  status: string;
  price_snapshot: Record<string, unknown>;
  provider_started_at: string | null;
};
export type StoredImage = {
  id: string;
  user_id: string;
  project_id: string;
  role: string;
  status: string;
  object_key: string;
  checksum: string;
  width: number;
  height: number;
  byte_size: number;
};
export interface JobStore {
  claim(
    worker: string,
    lease: number,
    concurrency: number,
  ): Promise<WorkerJob | null>;
  step(
    job: string,
    worker: string,
    action: string,
    data?: Record<string, unknown>,
  ): Promise<boolean>;
  image(id: string, owner: string): Promise<StoredImage | null>;
  read(key: string): Promise<Buffer>;
  brandAsset?(
    id: string,
    owner: string,
  ): Promise<{ object_key: string; checksum: string } | null>;
  write(key: string, bytes: Buffer): Promise<void>;
}
export function supabaseJobStore(admin: SupabaseClient): JobStore {
  return {
    async brandAsset(id, owner) {
      const r = await admin
        .from("brand_assets")
        .select("object_key,checksum")
        .eq("id", id)
        .eq("user_id", owner)
        .in("status", ["ready", "deleted"])
        .maybeSingle();
      if (r.error) throw Error("brand_asset");
      return r.data;
    },
    async claim(worker, lease, concurrency) {
      const { data, error } = await admin.rpc("claim_processing_job", {
        worker,
        lease_seconds: lease,
        max_concurrent: concurrency,
      });
      processingDbError(error);
      return data as WorkerJob | null;
    },
    async step(job, worker, action, p = {}) {
      const { data, error } = await admin.rpc("processing_step", {
        job,
        worker,
        action,
        p,
      });
      processingDbError(error);
      return data === true;
    },
    async image(id, owner) {
      const { data, error } = await admin
        .from("images")
        .select("*")
        .eq("id", id)
        .eq("user_id", owner)
        .maybeSingle();
      processingDbError(error);
      return data;
    },
    async read(key) {
      const { data, error } = await admin.storage.from("photos").download(key);
      if (error || !data || data.size > 10 * 1024 * 1024)
        throw new Error("storage");
      return Buffer.from(await data.arrayBuffer());
    },
    async write(key, bytes) {
      const { error } = await admin.storage
        .from("photos")
        .upload(key, bytes, { contentType: "image/webp", upsert: false });
      if (error) throw new Error("storage");
    },
  };
}
export type EditProvider = (
  config: ProcessingConfig,
  input: JobInput,
  source: Buffer,
  size: string,
  jobId: string,
  signal: AbortSignal,
  ownerId: string,
) => Promise<ProviderResult>;
export class ProcessingWorker {
  private stopped = false;
  private busy: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private controller: AbortController | null = null;
  constructor(
    private store: JobStore,
    private config: ProcessingConfig,
    private provider: EditProvider = (
      c,
      input,
      source,
      size,
      job,
      signal,
      owner,
    ) => editImage(c, input, source, size, job, signal, undefined, owner),
  ) {}
  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => this.wake(), 2500);
    this.timer.unref();
    this.wake();
  }
  wake() {
    if (this.stopped || this.busy) return;
    this.busy = this.once()
      .catch(() => {
        console.error(
          JSON.stringify({
            event: "processing_worker_error",
            code: "worker_unavailable",
          }),
        );
      })
      .finally(() => {
        this.busy = null;
      });
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.busy;
  }
  async once() {
    const worker = randomUUID();
    const job = await this.store.claim(
      worker,
      this.config.AI_TIMEOUT_SECONDS + 120,
      this.config.AI_GLOBAL_CONCURRENCY,
    );
    if (!job) return;
    const controller = new AbortController();
    this.controller = controller;
    const heartbeat = setInterval(() => {
      void this.store
        .step(job.id, worker, "heartbeat")
        .then((ok) => {
          if (!ok) controller.abort();
        })
        .catch(() => controller.abort());
    }, 20000);
    heartbeat.unref();
    let dispatched = !!job.provider_started_at;
    let received = job.status === "persisting";
    let prepared = job.status === "persisting";
    try {
      if (job.status === "persisting") {
        await this.recover(job, worker);
        return;
      }
      const input: JobInput & { controlled_retry?: string } = {
        project_id: job.project_id,
        input_image_id: job.input_image_id,
        submission_key: job.submission_key,
        mode: job.mode,
        instructions: job.instructions,
        quality: job.quality,
        ...job.settings,
        acknowledge_uncertain: false,
        provider_consent: true,
        controlled_retry: job.quality_retry_targets?.length
          ? retryDirection(
              job.quality_retry_targets,
              job.quality_retry_instructions ?? "",
            )
          : undefined,
      };
      const source = await this.store.image(job.input_image_id, job.user_id);
      if (
        !source ||
        source.role !== "original" ||
        source.status !== "ready" ||
        source.project_id !== job.project_id
      )
        throw new Error("source");
      let bytes: Buffer;
      try {
        bytes = await this.store.read(source.object_key);
        if (hash(bytes) !== source.checksum) throw new Error("checksum");
      } catch {
        throw new Error("source");
      }
      let logo: Buffer | undefined;
      const brand = job.settings.brand_snapshot;
      if (brand?.logo && brand.settings.logo_placement === "footer") {
        const asset = await this.store.brandAsset?.(brand.logo.id, job.user_id);
        if (!asset || asset.checksum !== brand.logo.checksum)
          throw Error("brand_asset");
        logo = await this.store.read(asset.object_key);
        if (hash(logo) !== brand.logo.checksum) throw Error("brand_asset");
      }
      if (controller.signal.aborted) return;
      if (!(await this.store.step(job.id, worker, "dispatch"))) return;
      dispatched = true;
      // Use each job's immutable model/price snapshot across configuration changes.
      const result = await this.provider(
        { ...this.config, AI_IMAGE_MODEL: job.model },
        input,
        bytes,
        job.output_size,
        job.id,
        controller.signal,
        job.user_id,
      );
      received = true;
      if (
        !(await this.checkpoint(job.id, worker, "response", {
          usage: result.usage,
          request_id: result.requestId,
          cost: estimateCost(result.usage, job.price_snapshot),
        }))
      )
        return;
      let output = await validateOutput(result.encoded, job.output_size);
      if (logo && brand) {
        try {
          output = await validateOutput(
            (await compositeBrand(output.bytes, logo, brand)).toString(
              "base64",
            ),
            job.output_size,
          );
        } catch {
          throw new AppError(
            502,
            "brand_composite_failed",
            "Brand compositing failed.",
          );
        }
      }
      if (
        !(await this.checkpoint(job.id, worker, "prepare", {
          filename: `sonkoflow-${job.mode}-${job.id.slice(0, 8)}.webp`,
          byte_size: output.bytes.length,
          width: output.width,
          height: output.height,
          checksum: output.checksum,
        }))
      )
        return;
      prepared = true;
      const key = `${job.user_id}/${job.result_image_id}.webp`;
      let persisted = false;
      // Only storage I/O is retried. The provider edit is called exactly once here.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.store.write(key, output.bytes);
        } catch {
          /* A lost upload acknowledgement may mean the object already exists. */
        }
        try {
          if (hash(await this.store.read(key)) !== output.checksum)
            throw new Error("checksum");
          persisted = true;
          break;
        } catch {
          /* Bounded storage retry with the same deterministic object key. */
        }
        if (attempt < 2)
          await new Promise((resolve) =>
            setTimeout(resolve, 150 * 3 ** attempt),
          );
      }
      if (!persisted) throw new Error("storage");
      await this.store.step(job.id, worker, "complete");
    } catch (error) {
      // A prepared result is reconciled from its deterministic private object key.
      // The SQL lease limits storage recovery to five passes; no new API edit runs.
      if (prepared) return;
      let code =
          error instanceof Error && error.message === "brand_asset"
            ? "brand_asset_unavailable"
            : "source_unavailable",
        safe = !dispatched,
        uncertain = false;
      if (error instanceof ProviderFailure) {
        code = error.code;
        safe = error.safe;
        uncertain = error.uncertain;
      } else if (
        error instanceof AppError &&
        error.code === "brand_composite_failed"
      ) {
        code = "brand_composite_failed";
        safe = false;
      } else if (error instanceof AppError && error.code === "invalid_output") {
        code = "invalid_output";
        safe = false;
      } else if (received) {
        code = "storage_failed";
        safe = false;
      } else if (dispatched) {
        code = "provider_interrupted";
        safe = false;
        uncertain = true;
      }
      await this.store.step(job.id, worker, "fail", { code, safe, uncertain });
    } finally {
      clearInterval(heartbeat);
      this.controller = null;
    }
  }
  private async checkpoint(
    job: string,
    worker: string,
    action: string,
    data: Record<string, unknown>,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.store.step(job, worker, action, data);
      } catch (error) {
        if (attempt >= 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * 3 ** attempt));
      }
    }
  }
  private async recover(job: WorkerJob, worker: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const output = job.output_image_id
          ? await this.store.image(job.output_image_id, job.user_id)
          : null;
        if (
          !output ||
          output.role !== "generated" ||
          output.project_id !== job.project_id ||
          hash(await this.store.read(output.object_key)) !== output.checksum
        )
          throw new Error("missing");
        await this.store.step(job.id, worker, "complete");
        return;
      } catch {
        if (attempt < 2)
          await new Promise((resolve) =>
            setTimeout(resolve, 150 * 3 ** attempt),
          );
      }
    }
    // Leave persisting until the lease expires. SQL bounds subsequent recovery.
  }
}
export class ProcessingEngine {
  readonly billing:BillingService|null;
  readonly config: ProcessingConfig | null;
  readonly missing: string[];
  readonly worker: ProcessingWorker | null;
  readonly quality;
  readonly packConfig;
  private packsChecked = 0;
  private packsAvailable = false;
  readonly qualityWorker: QualityWorker;
  private qualityChecked = 0;
  private qualityAvailable = false;
  private schemaChecked = 0;
  private schemaAvailable = false;
  constructor(
    readonly admin: SupabaseClient,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.billing=env.BILLING_ENABLED==="1"?new BillingService(admin,env):null;
    const loaded = loadProcessingConfig(env);
    this.config = loaded.config;
    this.missing = loaded.missing;
    this.quality = qualityConfig(env);
    this.packConfig = loadPackConfig(env);
    this.qualityWorker = new QualityWorker(
      qualityStore(admin),
      this.config ? this.quality.vision : null,
    );
    this.worker = this.config
      ? new ProcessingWorker(supabaseJobStore(admin), this.config)
      : null;
  }
  async schemaReady() {
    if (Date.now() - this.schemaChecked < 30000) return this.schemaAvailable;
    const result = await this.admin.rpc("processing_schema_version");
    this.schemaChecked = Date.now();
    this.schemaAvailable = !result.error && result.data === 2026102801;
    return this.schemaAvailable;
  }
  async capabilities(identity?:Identity) {
    const history = await this.schemaReady();
    const qualityReady = await this.qualityReady();
    const billing=this.billing&&identity?await this.billing.account(identity):null;
    const desired=billing?.plan==="free"?"low":["starter","payg"].includes(billing?.plan)?"medium":this.config?.AI_MAX_QUALITY;
    const ceiling=["low","medium","high"][Math.min(["low","medium","high"].indexOf(desired??"high"),["low","medium","high"].indexOf(this.config?.AI_MAX_QUALITY??"high"))];
    return {
      billing_metered:!!this.billing,billing_plan:billing?.plan??null,
      enabled: !!this.config && history,
      history_available: history,
      reason: !history
        ? "migration_required"
        : !this.config
          ? "configuration_required"
          : null,
      qualities: this.config
        ? (["low", "medium", "high"] as const).slice(
            0,
            Math.min(["low", "medium", "high"].indexOf(this.config.AI_MAX_QUALITY),["low","medium","high"].indexOf(ceiling??"high")) + 1,
          )
        : [],
      model: this.config?.AI_IMAGE_MODEL ?? null,
      default_quality:ceiling??this.config?.AI_MAX_QUALITY??"high",
      sizes: ["1024x1024", "1536x1024", "1024x1536"],
      daily_limit: this.config?.AI_USER_DAILY_LIMIT ?? null,
      product_quality_available: qualityReady,
      product_retry_limit: billing?.plan==="free"?0:this.quality.retryLimit,
      vision_assessment: billing?.plan!=="free" && !!this.config && !!this.quality.vision,
    };
  }
  async qualityReady() {
    if (Date.now() - this.qualityChecked < 30000) return this.qualityAvailable;
    const r = await this.admin.rpc("product_quality_schema_version");
    this.qualityChecked = Date.now();
    this.qualityAvailable = !r.error && r.data === 2026102802;
    return this.qualityAvailable;
  }
  async packsReady() {
    if (Date.now() - this.packsChecked < 30000) return this.packsAvailable;
    const r = await this.admin.rpc("product_packs_schema_version");
    this.packsChecked = Date.now();
    this.packsAvailable = !r.error && r.data === 2026102803;
    return this.packsAvailable;
  }
  makePackRetryPlan(
    parent: Record<string, any>,
    targets: CheckId[],
    instructions: string,
  ) {
    if (!this.config || !this.packConfig)
      throw new AppError(
        503,
        "packs_not_configured",
        "Pack allowance configuration is required for this retry.",
      );
    const context = parent.settings.pack_context;
    const plan = makeOutputPlan(
      packType.parse(parent.pack_output_type),
      parent.quality,
      {
        scene: context.scene,
        detail_focus: context.detail_focus,
        instructions: parent.instructions,
      },
      this.config,
      this.quality.vision,
      this.packConfig,
      this.quality.retryLimit,
      retryDirection(targets, instructions),
      parent.settings.brand_snapshot,
    );
    return {
      plan,
      fingerprint: hash(
        JSON.stringify({ parent: parent.id, plan, targets, instructions }),
      ),
    };
  }
  async submit(
    input: JobInput,
    identity: Identity,
    retry?: {
      parent: Record<string, any>;
      targets: CheckId[];
      instructions: string;
      quote_fingerprint?: string;
    },
  ) {
    const c = this.config;
    if (!c)
      throw new AppError(
        503,
        "processing_not_configured",
        "AI processing is not configured. Your photographs remain available.",
      );
    if (!(await this.schemaReady()))
      throw new AppError(
        503,
        "processing_migration_required",
        "The Phase 2 database migration has not been verified.",
      );
    if (input.mode === "product" && !(await this.qualityReady()))
      throw new AppError(
        503,
        "quality_migration_required",
        "The product quality migration must be verified before product editing. Personal and portrait editing remain available.",
      );
    if (
      ["low", "medium", "high"].indexOf(input.quality) >
      ["low", "medium", "high"].indexOf(c.AI_MAX_QUALITY)
    )
      throw new AppError(
        400,
        "quality_limit",
        "Choose an enabled quality setting.",
      );
    const { data: image, error } = await identity.client
      .from("images")
      .select("id,width,height,role,status")
      .eq("id", input.input_image_id)
      .eq("project_id", input.project_id)
      .maybeSingle();
    processingDbError(error);
    if (!image || image.role !== "original" || image.status !== "ready")
      throw new AppError(404, "not_found", "Reference photograph not found.");
    if (input.brand && !retry) {
      const prior = await identity.client
        .from("processing_jobs")
        .select("*")
        .eq("submission_key", input.submission_key)
        .maybeSingle();
      processingDbError(prior.error);
      if (prior.data) {
        if (prior.data.request_fingerprint !== fingerprint(input))
          throw new AppError(
            409,
            "submission_conflict",
            "This identifier belongs to a different edit.",
          );
        return prior.data as WorkerJob;
      }
    }
    let brand = retry?.parent.settings.brand_snapshot as
      | BrandSnapshot
      | undefined;
    if (!retry && input.brand) {
      brand = await new BrandService(this.admin).resolve(input.brand, identity);
      if (brand) {
        brand.settings.canvas = input.framing;
        brand.settings.background_style =
          input.background === "preserve"
            ? "preserve"
            : input.background === "studio"
              ? "studio"
              : ["solid", "neutral"].includes(brand.settings.background_style)
                ? brand.settings.background_style
                : "neutral";
      }
    }
    if (
      brand &&
      !retry &&
      input.product_options &&
      !input.product_options.operations.includes("background")
    )
      brand.settings.background_style = "preserve";
    let packRetryPlan: ReturnType<typeof makeOutputPlan> | null = null;
    if (retry?.parent.pack_id) {
      if (
        !this.packConfig ||
        image.width * image.height >
          this.packConfig.AI_PACK_TOKEN_ESTIMATES_JSON.max_source_pixels
      )
        throw new AppError(
          503,
          "pack_estimates_required",
          "This source is outside the configured pack estimate range.",
        );
      const quoted = this.makePackRetryPlan(
        retry.parent,
        retry.targets,
        retry.instructions,
      );
      if (retry.quote_fingerprint !== quoted.fingerprint)
        throw new AppError(
          409,
          "pack_quote_stale",
          "Review the retry allowance before generating.",
        );
      packRetryPlan = quoted.plan;
    }
    const metered=await meterPlan(this,input,image,identity,brand,retry?retryDirection(retry.targets,retry.instructions):'');
    this.worker?.start();
    const { data, error: submitError } = await this.admin.rpc(
      "submit_processing_job",
      {
        p: {
          ...input,
          user_id: identity.userId,
          settings: retry
            ? retry.parent.settings
            : {
                background: input.background,
                framing: input.framing,
                preserve_appearance: true,
                provider_consent: true,
                ...(brand ? { brand_snapshot: brand } : {}),
                ...(input.mode === "product"
                  ? {
                      product_options: productOptions.parse(
                        input.product_options ?? {},
                      ),
                    }
                  : {}),
              },
          model: c.AI_IMAGE_MODEL,
          output_size: outputSize(input, image.width, image.height),
          prompt_version: brand
            ? "brand-product-v1"
            : input.mode === "product"
              ? PRODUCT_PROMPT_VERSION
              : PROMPT_VERSION,
          request_fingerprint: retry
            ? hash(
                JSON.stringify({
                  input,
                  parent: retry.parent.id,
                  targets: retry.targets,
                  instructions: retry.instructions,
                }),
              )
            : fingerprint(input),
          price_snapshot: priceSnapshot(c),
          reserved_micro_usd: Math.ceil(
            (c.AI_OPERATION_RESERVE_USD +
              (input.mode === "product"
                ? (this.quality.vision?.AI_QUALITY_RESERVE_USD ?? 0)
                : 0)) *
              1e6,
          ),
          quality_retry_limit: this.quality.retryLimit,
          ...(input.mode === "product"
            ? {
                quality_model:
                  this.quality.vision?.AI_QUALITY_VISION_MODEL ?? null,
                quality_price_snapshot: this.quality.vision
                  ? visionPrice(this.quality.vision)
                  : null,
                quality_reserved_micro_usd: Math.ceil(
                  (this.quality.vision?.AI_QUALITY_RESERVE_USD ?? 0) * 1e6,
                ),
              }
            : {}),
          ...(metered&&!packRetryPlan?{reserved_micro_usd:metered.reserved_micro_usd,quality_reserved_micro_usd:metered.quality_reserved_micro_usd,pack_credit_plan:metered.plan,quality_model:metered.vision?.AI_QUALITY_VISION_MODEL??null,quality_price_snapshot:metered.vision?visionPrice(metered.vision):null,quality_retry_limit:metered.tier==='free'?0:this.quality.retryLimit}:{}),
          ...(packRetryPlan
            ? {
                prompt_version: packRetryPlan.job.prompt_version,
                reserved_micro_usd: packRetryPlan.job.reserved_micro_usd,
                quality_reserved_micro_usd:
                  packRetryPlan.job.quality_reserved_micro_usd,
                pack_credit_plan: packRetryPlan.job.pack_credit_plan,
              }
            : {}),
          ...(retry
            ? {
                quality_parent_id: retry.parent.id,
                quality_retry_targets: retry.targets,
                quality_retry_instructions: retry.instructions,
              }
            : {}),
        },
        limits: limits(c),
      },
    );
    processingDbError(submitError);
    this.worker?.start();
    this.worker?.wake();
    if (input.mode === "product") this.qualityWorker.start();
    return data as WorkerJob;
  }
  async start() {
    if (this.worker && (await this.schemaReady())) this.worker.start();
    if (await this.qualityReady()) this.qualityWorker.start();
  }
  async stop() {
    await this.worker?.stop();
    await this.qualityWorker.stop();
  }
}
