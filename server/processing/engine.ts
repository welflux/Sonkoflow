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
  write(key: string, bytes: Buffer): Promise<void>;
}
export function supabaseJobStore(admin: SupabaseClient): JobStore {
  return {
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
      const output = await validateOutput(result.encoded, job.output_size);
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
      let code = "source_unavailable",
        safe = !dispatched,
        uncertain = false;
      if (error instanceof ProviderFailure) {
        code = error.code;
        safe = error.safe;
        uncertain = error.uncertain;
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
  readonly config: ProcessingConfig | null;
  readonly missing: string[];
  readonly worker: ProcessingWorker | null;
  readonly quality;
  readonly qualityWorker: QualityWorker;
  private qualityChecked = 0;
  private qualityAvailable = false;
  private schemaChecked = 0;
  private schemaAvailable = false;
  constructor(
    readonly admin: SupabaseClient,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    const loaded = loadProcessingConfig(env);
    this.config = loaded.config;
    this.missing = loaded.missing;
    this.quality = qualityConfig(env);
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
  async capabilities() {
    const history = await this.schemaReady();
    const qualityReady = await this.qualityReady();
    return {
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
            ["low", "medium", "high"].indexOf(this.config.AI_MAX_QUALITY) + 1,
          )
        : [],
      model: this.config?.AI_IMAGE_MODEL ?? null,
      default_quality: this.config?.AI_MAX_QUALITY ?? "high",
      sizes: ["1024x1024", "1536x1024", "1024x1536"],
      daily_limit: this.config?.AI_USER_DAILY_LIMIT ?? null,
      product_quality_available: qualityReady,
      product_retry_limit: this.quality.retryLimit,
      vision_assessment: !!this.config && !!this.quality.vision,
    };
  }
  async qualityReady() {
    if (Date.now() - this.qualityChecked < 30000) return this.qualityAvailable;
    const r = await this.admin.rpc("product_quality_schema_version");
    this.qualityChecked = Date.now();
    this.qualityAvailable = !r.error && r.data === 2026102802;
    return this.qualityAvailable;
  }
  async submit(
    input: JobInput,
    identity: Identity,
    retry?: {
      parent: Record<string, any>;
      targets: CheckId[];
      instructions: string;
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
          prompt_version:
            input.mode === "product" ? PRODUCT_PROMPT_VERSION : PROMPT_VERSION,
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
