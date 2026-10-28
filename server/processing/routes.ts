import type { Express, Response } from "express";
import type { Identity } from "../services.js";
import { z } from "zod";
import { uuid, AppError } from "../security.js";
import { jobInput, jobFields, processingDbError, errors } from "./contracts.js";
import { ProcessingEngine } from "./engine.js";
function present(job: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const field of jobFields.split(",")) result[field] = job[field] ?? null;
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
) {
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
    res.json(await engine.capabilities()),
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
      .select(jobFields)
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
      .select(jobFields)
      .eq("id", id)
      .maybeSingle();
    processingDbError(error);
    if (!data) throw new AppError(404, "not_found", "Edit not found.");
    res.json({ job: present(data as unknown as Record<string, unknown>) });
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
