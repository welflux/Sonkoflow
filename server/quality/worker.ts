import { assessBrandLayout } from "../brand/assessment.js";
import { brandDirection, type BrandSnapshot } from "../brand/contracts.js";
import { packDirection, type PackContext } from "../packs/contracts.js";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hash } from "../security.js";
import { ProviderFailure } from "../processing/provider.js";
import { supabaseJobStore, type JobStore } from "../processing/engine.js";
import { processingDbError } from "../processing/contracts.js";
import { localAssessment } from "./analysis.js";
import {
  productOptions,
  report,
  retryDirection,
  unavailable,
  missingSemanticChecks,
  type QualityReport,
  type CheckId,
} from "./contracts.js";
import { type VisionConfig } from "./config.js";
import { assessWithVision, visionCost } from "./vision.js";
export type QualityJob = {
  id: string;
  user_id: string;
  input_image_id: string;
  output_image_id: string;
  output_size: string;
  settings: {
    product_options?: unknown;
    background: string;
    pack_context?: PackContext;
    brand_snapshot?: BrandSnapshot;
  };
  instructions: string;
  quality_model: string | null;
  quality_price_snapshot: Record<string, unknown>;
  quality_retry_targets?: CheckId[];
  quality_retry_instructions?: string;
};
export type QualityStore = Pick<JobStore, "read" | "image"> & {
  claim(worker: string): Promise<QualityJob | null>;
  step(
    job: string,
    worker: string,
    action: string,
    data?: Record<string, unknown>,
  ): Promise<boolean>;
};
export function qualityStore(admin: SupabaseClient): QualityStore {
  const images = supabaseJobStore(admin);
  return {
    image: images.image,
    read: images.read,
    async claim(worker) {
      const r = await admin.rpc("claim_product_assessment", { worker });
      processingDbError(r.error);
      return r.data;
    },
    async step(job, worker, action, p = {}) {
      const r = await admin.rpc("product_assessment_step", {
        job,
        worker,
        action,
        p,
      });
      processingDbError(r.error);
      return r.data === true;
    },
  };
}
export class QualityWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy: Promise<void> | null = null;
  private controller: AbortController | null = null;
  constructor(
    private store: QualityStore,
    private config: VisionConfig | null,
    private vision: typeof assessWithVision = assessWithVision,
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.wake(), 2500);
    this.timer.unref();
    this.wake();
  }
  wake() {
    if (this.busy) return;
    this.busy = this.once()
      .catch(() =>
        console.error(
          JSON.stringify({
            event: "quality_worker_error",
            code: "quality_unavailable",
          }),
        ),
      )
      .finally(() => {
        this.busy = null;
      });
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.busy;
  }
  private async checkpoint(
    job: string,
    worker: string,
    action: string,
    data: Record<string, unknown>,
  ) {
    for (let i = 0; ; i++) {
      try {
        return await this.store.step(job, worker, action, data);
      } catch (e) {
        if (i >= 2) throw e;
        await new Promise((r) => setTimeout(r, 150 * 3 ** i));
      }
    }
  }
  async once() {
    const worker = randomUUID(),
      job = await this.store.claim(worker);
    if (!job) return;
    const controller = new AbortController();
    this.controller = controller;
    const beat = setInterval(() => {
      void this.store
        .step(job.id, worker, "heartbeat")
        .then((ok) => {
          if (!ok) controller.abort();
        })
        .catch(() => controller.abort());
    }, 20000);
    beat.unref();
    let result: QualityReport | null = null;
    let failureCode = "assessment_storage";
    try {
      const original = await this.store.image(job.input_image_id, job.user_id),
        generated = await this.store.image(job.output_image_id, job.user_id);
      if (
        !original ||
        !generated ||
        original.role !== "original" ||
        generated.role !== "generated" ||
        original.status !== "ready" ||
        generated.status !== "ready" ||
        original.project_id !== generated.project_id
      )
        throw new Error("source");
      const source = await this.store.read(original.object_key),
        output = await this.store.read(generated.object_key);
      if (
        hash(source) !== original.checksum ||
        hash(output) !== generated.checksum
      )
        throw new Error("integrity");
      const options = productOptions.parse(job.settings.product_options ?? {});
      result = await localAssessment(source, output, job.output_size, options);
      if (job.settings.brand_snapshot)
        result = report([
          ...result.checks,
          ...(await assessBrandLayout(output, job.settings.brand_snapshot)),
        ]);
      if (
        job.settings.pack_context &&
        ["lifestyle", "detail", "wide"].includes(job.settings.pack_context.type)
      )
        result = report([
          ...result.checks,
          {
            id: "pack_fidelity",
            label: "Output-specific fidelity review",
            status: "needs_review",
            method: "customer",
            confidence: null,
            explanation:
              job.settings.pack_context.type === "detail"
                ? "This is a generated closer view, not verified detail recovery. Confirm every visible feature and do not infer unseen product details."
                : "This creative composition changes the setting. Review product shape, labels, materials and accessories against the original; environmental elements are not included product features.",
          },
        ]);
      failureCode = "assessment_persistence";
      if (!(await this.checkpoint(job.id, worker, "local", { report: result })))
        return;
      if (job.quality_model) {
        failureCode = "assessment_configuration";
        if (!this.config) throw new Error("configuration");
        failureCode = "assessment_persistence";
        if (!(await this.store.step(job.id, worker, "dispatch"))) return;
        // Immutable model/prices; exactly one assessment request, never retried.
        const direction = job.quality_retry_targets?.length
          ? retryDirection(
              job.quality_retry_targets,
              job.quality_retry_instructions ?? "",
            )
          : "";
        failureCode = "assessment_provider_failed";
        const response = await this.vision(
          {
            ...this.config,
            AI_QUALITY_VISION_MODEL:
              job.quality_model as VisionConfig["AI_QUALITY_VISION_MODEL"],
          },
          source,
          output,
          options,
          job.settings.background,
          `${job.instructions}\n${direction}\n${brandDirection(job.settings.brand_snapshot)}\n${job.settings.pack_context ? packDirection(job.settings.pack_context) : ""}`,
          job.id,
          controller.signal,
        );
        failureCode = "assessment_persistence";
        if (
          !(await this.checkpoint(job.id, worker, "response", {
            usage: response.usage,
            cost: visionCost(response.usage, job.quality_price_snapshot),
            request_id: response.requestId,
          }))
        )
          return;
        result = report([
          ...result.checks,
          ...(response.checks ?? [
            ...missingSemanticChecks(result.checks),
            unavailable(
              "The vision provider did not return a usable assessment. The generated photograph is retained; inspect it yourself. Provider usage may have been incurred.",
            ),
          ]),
        ]);
        await this.checkpoint(
          job.id,
          worker,
          response.checks ? "complete" : "unavailable",
          {
            report: result,
            ...(!response.checks ? { error_code: "assessment_invalid" } : {}),
          },
        );
      } else {
        result = report([
          ...result.checks,
          ...missingSemanticChecks(result.checks),
          unavailable(
            "Detailed visibility, labels, packaging and instruction compliance require human review. Optional vision assessment is disabled; local comparisons cannot establish product fidelity.",
          ),
        ]);
        await this.checkpoint(job.id, worker, "complete", { report: result });
      }
    } catch (error) {
      if (
        error instanceof ProviderFailure &&
        [
          "assessment_interrupted",
          "assessment_quota",
          "assessment_credentials",
          "assessment_invalid",
          "assessment_provider_failed",
        ].includes(error.code)
      )
        failureCode = error.code;
      const explanation =
        failureCode === "assessment_storage"
          ? "The stored reference or result could not be retrieved and verified. No assessment API request was made."
          : failureCode === "assessment_configuration"
            ? "Vision assessment configuration is unavailable. No assessment API request was made."
            : failureCode === "assessment_quota"
              ? "The vision provider rejected the assessment because its quota was unavailable."
              : failureCode === "assessment_credentials"
                ? "The vision provider rejected assessment access. The site owner needs to check provider configuration."
                : failureCode === "assessment_persistence"
                  ? "Assessment results could not be saved completely; an assessment API request may already have incurred usage."
                  : "The vision assessment failed or was interrupted; its billing outcome may be unknown.";
      const known = result?.checks ?? [];
      const failed = report([
        ...known,
        ...missingSemanticChecks(known),
        unavailable(
          `${explanation} The generated result is retained when available; review it yourself. No image generation or vision request will be repeated automatically.`,
        ),
      ]);
      await this.checkpoint(job.id, worker, "unavailable", {
        report: failed,
        error_code: failureCode,
      });
    } finally {
      clearInterval(beat);
      this.controller = null;
    }
  }
}
