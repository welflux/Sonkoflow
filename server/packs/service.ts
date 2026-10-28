import { randomUUID } from "node:crypto";
import { AppError, hash } from "../security.js";
import { ProcessingEngine, supabaseJobStore } from "../processing/engine.js";
import {
  jobFields,
  qualityFields,
  processingDbError,
  errors,
} from "../processing/contracts.js";
import { limits } from "../processing/config.js";
import { validateOutput } from "../processing/provider.js";
import type { Identity } from "../services.js";
import {
  packInput,
  createPackInput,
  requestFingerprint,
  packJobFields,
  packDbError,
  outputSpecs,
  type PackInput,
  packType,
} from "./contracts.js";
import { makePackPlan } from "./plan.js";
import { imageZip } from "./zip.js";
export const fields = `${jobFields},${qualityFields},${packJobFields}`;
function db(error: any) {
  packDbError(error);
  processingDbError(error);
}
export function packProgress(pack: any, jobs: any[]) {
  const outputs = pack.configuration.outputs.map((o: any) => {
    const versions = jobs
      .filter((j) => j.pack_output_type === o.type)
      .sort(
        (a, b) =>
          (b.quality_retry_number ?? 0) - (a.quality_retry_number ?? 0) ||
          String(b.created_at).localeCompare(String(a.created_at)),
      );
    const current = versions[0] ?? null,
      approved =
        versions.find(
          (j) =>
            j.status === "completed" &&
            j.output_image_id &&
            j.user_decision === "approved",
        ) ?? null;
    for (const j of versions)
      j.quality_retry_used = Math.max(
        0,
        ...versions.map((v) => v.quality_retry_number ?? 0),
      );
    return {
      type: o.type,
      spec: outputSpecs[o.type as keyof typeof outputSpecs],
      current,
      approved,
      versions,
    };
  });
  const missing = outputs.filter((o: any) => !o.current).length;
  const pending = outputs.filter(
    (o: any) =>
      o.current &&
      ["queued", "running", "persisting"].includes(o.current.status),
  ).length;
  const completed = outputs.filter((o: any) =>
    o.versions.some((j: any) => j.status === "completed" && j.output_image_id),
  ).length;
  const failed = outputs.filter((o: any) =>
    ["failed", "cancelled", "uncertain"].includes(o.current?.status),
  ).length;
  const reviewing = outputs.filter((o: any) =>
    ["pending", "running"].includes(o.current?.quality_state),
  ).length;
  return {
    outputs,
    progress: {
      total: outputs.length,
      missing,
      completed,
      failed,
      pending,
      reviewing,
      approved: outputs.filter((o: any) => o.approved).length,
    },
    status: missing
      ? "incomplete"
      : pending
        ? "processing"
        : reviewing
          ? "assessing"
          : failed
            ? completed
              ? "partial"
              : "failed"
            : "ready_for_review",
  };
}
export class PackService {
  constructor(
    readonly engine: ProcessingEngine,
    private storage = supabaseJobStore(engine.admin),
  ) {}
  async configured() {
    const e = this.engine;
    if (
      !e.config ||
      !e.packConfig ||
      !(await e.packsReady()) ||
      !(await e.qualityReady())
    )
      throw new AppError(
        503,
        "packs_not_configured",
        "Product packs are unavailable until allowance estimates, processing and database configuration are ready.",
      );
    return { c: e.config, pc: e.packConfig };
  }
  async source(input: PackInput, identity: Identity) {
    const r = await identity.client
      .from("images")
      .select("id,project_id,width,height,checksum,role,status")
      .eq("id", input.input_image_id)
      .eq("project_id", input.project_id)
      .maybeSingle();
    db(r.error);
    if (!r.data || r.data.role !== "original" || r.data.status !== "ready")
      throw new AppError(
        404,
        "not_found",
        "Ready original photograph not found.",
      );
    return r.data;
  }
  async allowance(identity: Identity, initialize = false) {
    if (initialize) {
      const pc = this.engine.packConfig!;
      const r = await this.engine.admin.rpc("ensure_pack_account", {
        owner: identity.userId,
        initial_credits: pc.AI_PACK_INITIAL_CREDITS,
        unit_micro_usd: pc.AI_PACK_CREDIT_MICRO_USD,
      });
      db(r.error);
    }
    const r = await identity.client
      .from("pack_credit_accounts")
      .select("balance_credits,reserved_credits,unit_micro_usd")
      .maybeSingle();
    db(r.error);
    const account = r.data ?? {
      balance_credits: 0,
      reserved_credits: 0,
      unit_micro_usd: this.engine.packConfig?.AI_PACK_CREDIT_MICRO_USD ?? null,
    };
    return {
      ...account,
      available_credits: account.balance_credits - account.reserved_credits,
    };
  }
  async quote(raw: unknown, identity: Identity) {
    const input = packInput.parse(raw),
      { c, pc } = await this.configured(),
      source = await this.source(input, identity);
    const plan = makePackPlan(
        input,
        source,
        c,
        this.engine.quality.vision,
        pc,
        this.engine.quality.retryLimit,
      ),
      allowance = await this.allowance(identity, true);
    return {
      outputs: plan.outputs.map(({ job, ...publicOutput }) => publicOutput),
      estimated_credits: plan.estimated_credits,
      reserved_credits: plan.reserved_credits,
      quote_fingerprint: plan.fingerprint,
      allowance,
      can_generate: allowance.available_credits >= plan.reserved_credits,
      estimate_version: plan.estimate_version,
      price_version: plan.price_version,
    };
  }
  async create(raw: unknown, identity: Identity) {
    const parsed = createPackInput.parse(raw),
      input = packInput.parse(
        Object.fromEntries(
          Object.entries(parsed).filter(
            ([k]) =>
              ![
                "submission_key",
                "quote_fingerprint",
                "provider_consent",
              ].includes(k),
          ),
        ),
      );
    const fingerprint = requestFingerprint(input);
    const prior = await identity.client
      .from("product_packs")
      .select("id,request_fingerprint")
      .eq("submission_key", parsed.submission_key)
      .maybeSingle();
    db(prior.error);
    if (prior.data) {
      if (prior.data.request_fingerprint !== fingerprint)
        throw new AppError(
          409,
          "submission_conflict",
          "This identifier belongs to a different pack.",
        );
      if (this.engine.config) {
        this.engine.worker?.start?.();
        this.engine.worker?.wake();
      }
      return { id: prior.data.id };
    }
    const { c, pc } = await this.configured(),
      source = await this.source(input, identity),
      plan = makePackPlan(
        input,
        source,
        c,
        this.engine.quality.vision,
        pc,
        this.engine.quality.retryLimit,
      );
    if (plan.fingerprint !== parsed.quote_fingerprint)
      throw new AppError(
        409,
        "pack_quote_stale",
        "Review the updated pack plan before generating.",
      );
    const r = await this.engine.admin.rpc("create_product_pack", {
      p: {
        user_id: identity.userId,
        project_id: input.project_id,
        input_image_id: input.input_image_id,
        submission_key: parsed.submission_key,
        request_fingerprint: fingerprint,
        configuration: input,
        plan: {
          outputs: plan.outputs.map(({ job, ...o }) => o),
          estimated_credits: plan.estimated_credits,
          reserved_credits: plan.reserved_credits,
          estimate_version: plan.estimate_version,
          price_version: plan.price_version,
        },
      },
      jobs: plan.outputs.map((o) => ({
        ...o.job,
        submission_key: randomUUID(),
        request_fingerprint: hash(
          `${fingerprint}:${o.type}:${plan.fingerprint}`,
        ),
        acknowledge_uncertain: input.acknowledge_uncertain,
      })),
      limits: limits(c),
      pack_limits: {
        max_outputs: pc.AI_PACK_MAX_OUTPUTS,
        daily: pc.AI_PACK_DAILY_LIMIT,
        active: pc.AI_PACK_ACTIVE_LIMIT,
        initial_credits: pc.AI_PACK_INITIAL_CREDITS,
        unit_micro_usd: pc.AI_PACK_CREDIT_MICRO_USD,
      },
    });
    db(r.error);
    await this.engine.start();
    this.engine.worker?.wake();
    return { id: r.data.id };
  }
  async get(id: string, identity: Identity) {
    const p = await identity.client
      .from("product_packs")
      .select("id,project_id,input_image_id,configuration,plan,created_at")
      .eq("id", id)
      .maybeSingle();
    db(p.error);
    if (!p.data) throw new AppError(404, "not_found", "Image pack not found.");
    const j = await identity.client
      .from("processing_jobs")
      .select(fields)
      .eq("pack_id", id)
      .order("created_at", { ascending: true });
    db(j.error);
    const reservations = j.data?.length
      ? await identity.client
          .from("pack_credit_reservations")
          .select(
            "job_id,stage,attempt,state,reserved_credits,actual_credits,actual_micro_usd,dispatched_at",
          )
          .in(
            "job_id",
            j.data.map((row: any) => row.id),
          )
      : { data: [], error: null };
    db(reservations.error);
    return {
      pack: p.data,
      ...packProgress(
        p.data,
        (j.data ?? []).map((job: any) => ({
          ...job,
          credit_reservations: (reservations.data ?? []).filter(
            (r: any) => r.job_id === job.id,
          ),
          message: job.error_code
            ? (errors[job.error_code] ?? "This output could not finish.")
            : null,
        })),
      ),
      allowance: await this.allowance(identity),
    };
  }
  async zip(id: string, identity: Identity) {
    const result = await this.get(id, identity),
      approved = result.outputs.filter((o: any) => o.approved);
    if (!approved.length)
      throw new AppError(
        409,
        "no_approved_outputs",
        "Approve a completed output before downloading a ZIP.",
      );
    const files: { name: string; bytes: Buffer }[] = [];
    for (const o of approved) {
      const job = o.approved;
      const r = await identity.client
        .from("images")
        .select("id,role,status,object_key,checksum,width,height")
        .eq("id", job.output_image_id)
        .maybeSingle();
      db(r.error);
      if (!r.data || r.data.role !== "generated" || r.data.status !== "ready")
        throw new AppError(
          409,
          "pack_output_unavailable",
          "An approved output was deleted or is unavailable. Refresh the pack.",
        );
      let bytes: Buffer;
      try {
        bytes = await this.storage.read(r.data.object_key);
        if (hash(bytes) !== r.data.checksum) throw new Error();
        await validateOutput(bytes.toString("base64"), job.output_size);
      } catch {
        throw new AppError(
          503,
          "pack_storage_unavailable",
          "A saved output could not be verified. The archive was not created.",
        );
      }
      files.push({
        name: `${String(files.length + 1).padStart(2, "0")}-${o.type}-${job.id.slice(0, 8)}.webp`,
        bytes,
      });
    }
    // Check decisions again after storage I/O; do not archive a newly rejected version.
    const current = await this.get(id, identity);
    if (
      approved.some(
        (o: any) =>
          !current.outputs.some(
            (n: any) =>
              n.type === o.type &&
              n.approved?.id === o.approved.id &&
              n.approved.decision_revision === o.approved.decision_revision,
          ),
      )
    )
      throw new AppError(
        409,
        "pack_changed",
        "Pack decisions changed during download. Refresh and try again.",
      );
    return imageZip(files);
  }
}
