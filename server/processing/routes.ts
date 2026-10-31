import { packJobFields } from "../packs/contracts.js";
import type { Express, Response } from "express";
import type { Identity } from "../services.js";
import { z } from "zod";
import { uuid, AppError } from "../security.js";
import {
  jobInput,
  jobFields,
  qualityFields,
  processingDbError,
  errors,
} from "./contracts.js";
import { retryRequest } from "../quality/contracts.js";
import { ProcessingEngine } from "./engine.js";
import { type ClaidTrial, publicTrialSettings } from './claid-trial.js';
function present(job: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const field of `${jobFields},${qualityFields},${packJobFields}`.split(
    ",",
  ))
    result[field] = job[field] ?? null;
  const settings=result.settings as Record<string,any>|null;
  result.settings=publicTrialSettings(settings);
  if(settings?.engine_route){
    const route=settings.engine_route;
    // Customer history needs provider/operation context, not internal pricing,
    // reservation multipliers or the worker's immutable-route digest.
    result.settings={...settings,engine_route:Object.fromEntries(['version','provider','model','experience','operation','size'].map(key=>[key,route[key]]))};
  }
  result.message =
    typeof job.error_code === "string"
      ? (errors[job.error_code] ??
        "Processing could not finish. Your source photograph is retained.")
      : null;
  return result;
}
export function processingRoutes(
  app: Express,
  engine: ProcessingEngine,
  who: (res: Response) => Identity,
  trial?: ClaidTrial,
) {
  const fields = async () =>
    jobFields +
    ((await engine.qualityReady()) ? `,${qualityFields}` : "") +
    ((await engine.packsReady?.()) ? `,${packJobFields}` : "");
  app.get("/api/images/:id", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const identity = who(res);
    const { data, error } = await identity.client
      .from("images")
      .select("id,project_id,role,status,filename,width,height")
      .eq("id", id)
      .maybeSingle();
    processingDbError(error);
    if (!data) throw new AppError(404, "not_found", "Photograph not found.");
    const project = await identity.client
      .from("projects")
      .select("audience")
      .eq("id", data.project_id)
      .maybeSingle();
    processingDbError(project.error);
    res.json({ image: { ...data, audience: project.data?.audience } });
  });
  app.get("/api/processing/capabilities", async (_req, res) =>
    res.json({...await engine.capabilities(who(res)),...(trial?{claid_trial:await trial.capabilities(who(res))}:{})}),
  );
  app.post("/api/jobs", async (req, res) => {
    const job = await engine.submit(jobInput.parse(req.body), who(res));
    res
      .status(
        ["completed", "failed", "uncertain", "cancelled"].includes(job.status)
          ? 200
          : 202,
      )
      .json({ job: present(job as unknown as Record<string, unknown>) });
  });
  app.get("/api/jobs", async (req, res) => {
    const input = z
      .object({
        project_id: uuid,
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .strict()
      .parse(req.query);
    const { data, error } = await who(res)
      .client.from("processing_jobs")
      .select(await fields())
      .eq("project_id", input.project_id)
      .not("mode", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(input.offset, input.offset + 24);
    processingDbError(error);
    res.json({
      jobs: (data ?? []).map((j) =>
        present(j as unknown as Record<string, unknown>),
      ),
      next_offset: (data?.length ?? 0) === 25 ? input.offset + 25 : null,
    });
  });
  app.get("/api/jobs/:id", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { data, error } = await who(res)
      .client.from("processing_jobs")
      .select(await fields())
      .eq("id", id)
      .maybeSingle();
    processingDbError(error);
    if (!data) throw new AppError(404, "not_found", "Edit not found.");
    const saved = data as unknown as Record<string, unknown>;
    if (saved.quality_state && saved.mode === "product") {
      const root =
        typeof saved.quality_root_id === "string" ? saved.quality_root_id : id;
      const family = await who(res)
        .client.from("processing_jobs")
        .select("quality_retry_number")
        .eq("quality_root_id", root);
      processingDbError(family.error);
      saved.quality_retry_used = Math.max(
        0,
        ...(family.data ?? []).map((j: any) => j.quality_retry_number),
      );
      saved.quality_retry_limit = Math.min(
        Number(saved.quality_retry_limit),
        engine.quality.retryLimit,
      );
    }
    res.json({
      job: {
        ...present(saved),
        ...(saved.quality_retry_used !== undefined
          ? { quality_retry_used: saved.quality_retry_used }
          : {}),
      },
    });
  });
  app.post("/api/jobs/:id/decision", async (req, res) => {
    const id = uuid.parse(req.params.id),
      identity = who(res);
    const body = z
      .object({
        decision: z.enum(["approved", "rejected"]),
        request_key: uuid,
        expected_revision: z.number().int().min(0).max(50),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    if (!(await engine.qualityReady()))
      throw new AppError(
        503,
        "quality_migration_required",
        "Product review storage is not configured.",
      );
    const prior = await identity.client
      .from("processing_jobs")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    processingDbError(prior.error);
    if (!prior.data) throw new AppError(404, "not_found", "Edit not found.");
    const r = await engine.admin.rpc("decide_product_result", {
      job: id,
      owner: identity.userId,
      decision: body.decision,
      request_key: body.request_key,
      expected_revision: body.expected_revision,
    });
    processingDbError(r.error);
    res.json({ ok: true, revision: r.data });
  });
  app.post("/api/jobs/:id/quality-retry", async (req, res) => {
    const id = uuid.parse(req.params.id),
      body = retryRequest.parse(req.body),
      identity = who(res);
    if (!(await engine.qualityReady()))
      throw new AppError(
        503,
        "quality_migration_required",
        "Product quality storage is not configured.",
      );
    const prior = await identity.client
      .from("processing_jobs")
      .select(await fields())
      .eq("id", id)
      .maybeSingle();
    processingDbError(prior.error);
    if (!prior.data) throw new AppError(404, "not_found", "Edit not found.");
    const parent = prior.data as any;
    if (
      parent.mode !== "product" ||
      parent.status !== "completed" ||
      !["completed", "unavailable"].includes(parent.quality_state) ||
      !parent.input_image_id
    )
      throw new AppError(
        409,
        "quality_retry_state",
        "Wait for a completed product result and assessment before retrying.",
      );
    const input = jobInput.parse({
      project_id: parent.project_id,
      input_image_id: parent.input_image_id,
      submission_key: body.submission_key,
      mode: "product",
      quality: parent.quality,
      framing: parent.settings.framing,
      background: parent.settings.background,
      product_options: parent.settings.product_options,
      instructions: parent.instructions,
      preserve_appearance: true,
      provider_consent: true,
      acknowledge_uncertain: body.acknowledge_uncertain,
    });
    const job = await engine.submit(input, identity, {
      parent,
      targets: body.targets,
      instructions: body.instructions,
      quote_fingerprint: body.quote_fingerprint,
    });
    res
      .status(202)
      .json({ job: present(job as unknown as Record<string, unknown>) });
  });
  for (const action of ["retry", "cancel"] as const)
    app.post(`/api/jobs/:id/${action}`, async (req, res) => {
      const id = uuid.parse(req.params.id);
      z.object({}).strict().parse(req.body);
      if (action === "retry" && !engine.config)
        throw new AppError(
          503,
          "processing_not_configured",
          "AI processing is not configured.",
        );
      // Read through the user client before any privileged state transition.
      const identity = who(res);
      const prior = await identity.client
        .from("processing_jobs")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      processingDbError(prior.error);
      if (!prior.data) throw new AppError(404, "not_found", "Edit not found.");
      const { data, error } = await engine.admin.rpc(
        action === "retry" ? "retry_processing_job" : "cancel_processing_job",
        { job: id, owner: identity.userId },
      );
      processingDbError(error);
      if (!data)
        throw new AppError(
          409,
          "job_state",
          action === "retry"
            ? "This request cannot be safely retried. Review its status before submitting a new edit."
            : "Only a queued edit can be cancelled.",
        );
      if (action === "retry") {
        engine.worker?.start();
        engine.worker?.wake();
      }
      res.json({ ok: true });
    });
}
