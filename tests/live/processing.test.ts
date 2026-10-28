import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import request from "supertest";
import sharp from "sharp";
import { loadConfig } from "../../server/config.js";
import { loadProcessingConfig } from "../../server/processing/config.js";
import { createApp } from "../../server/app.js";
import { services } from "../../server/services.js";
// REAL, BILLABLE test. Explicit opt-in, configured pricing/budgets, and a designated
// development Supabase/OpenAI project are required. No provider mock is used.
test(
  "real OpenAI reference edits in all three modes, saved comparison, isolation and download",
  {
    skip: process.env.RUN_LIVE_PROCESSING !== "1",
    timeout: 25 * 60_000,
  },
  async () => {
    const config = loadConfig();
    assert(config, "Existing Supabase/session configuration is required.");
    const processing = loadProcessingConfig();
    assert(
      processing.config,
      "Enable reviewed OpenAI configuration and budgets first.",
    );
    config.NODE_ENV = "test";
    const app = createApp(config);
    const svc = services(config);
    const ownerIds: string[] = [];
    const jobs: string[] = [];
    const agents = [request.agent(app), request.agent(app)];
    const password = `A!${randomUUID()}long`;
    try {
      for (let i = 0; i < 2; i++) {
        const email = `sonkoflow-phase2-${randomUUID()}@example.invalid`;
        const created = await svc.admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        assert(
          !created.error && created.data.user,
          "Could not create an isolated development test account.",
        );
        ownerIds.push(created.data.user.id);
        const signed = await agents[i]
          .post("/api/auth/signin")
          .set("Origin", config.APP_ORIGIN)
          .send({ email, password });
        assert.equal(signed.status, 200, "Test sign-in must succeed.");
      }
      const project = await agents[0]
        .post("/api/projects")
        .set("Origin", config.APP_ORIGIN)
        .send({ name: "Phase 2 real-provider test", audience: "ecommerce" });
      assert.equal(project.status, 201);
      for (const [mode, file] of [
        ["product", "footwear-small.webp"],
        ["portrait", "portrait-small.webp"],
        ["personal", "lifestyle-small.webp"],
      ] as const) {
        const inputId = randomUUID();
        const uploaded = await agents[0]
          .post("/api/images")
          .set("Origin", config.APP_ORIGIN)
          .field("project_id", project.body.project.id)
          .field("id", inputId)
          .attach("image", await readFile(`public/images/${file}`), file);
        assert.equal(uploaded.status, 201);
        const payload = {
          project_id: project.body.project.id,
          input_image_id: inputId,
          submission_key: randomUUID(),
          mode,
          quality: "low",
          framing: "square",
          background: "preserve",
          preserve_appearance: true,
          provider_consent: true,
          instructions:
            "Improve photographic lighting while preserving the reference subject.",
        };
        const submitted = await agents[0]
          .post("/api/jobs")
          .set("Origin", config.APP_ORIGIN)
          .send(payload);
        assert.equal(
          submitted.status,
          202,
          "The real job must be admitted by the configured budgets and migration.",
        );
        jobs.push(submitted.body.job.id);
        const duplicate = await agents[0]
          .post("/api/jobs")
          .set("Origin", config.APP_ORIGIN)
          .send(payload);
        assert.equal(
          duplicate.body.job.id,
          submitted.body.job.id,
          "Duplicate submission must return the same job.",
        );
        assert.equal(
          (await agents[1].get(`/api/jobs/${submitted.body.job.id}`)).status,
          404,
          "Another tenant must not see the job.",
        );
        let saved;
        const deadline =
          Date.now() + (processing.config.AI_TIMEOUT_SECONDS + 650) * 1000;
        while (Date.now() < deadline) {
          const result = await agents[0].get(
            `/api/jobs/${submitted.body.job.id}`,
          );
          assert.equal(result.status, 200);
          saved = result.body.job;
          if (
            ["completed", "failed", "uncertain", "cancelled"].includes(
              saved.status,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        assert.equal(
          saved?.status,
          "completed",
          `Real ${mode} generation did not complete; inspect the saved job safely.`,
        );
        assert(saved.output_image_id);
        const downloaded = await agents[0].get(
          `/api/images/${saved.output_image_id}/content?download=1`,
        );
        assert.equal(downloaded.status, 200);
        assert.match(downloaded.headers["content-disposition"], /attachment/);
        const metadata = await sharp(downloaded.body).metadata();
        assert.equal(metadata.format, "webp");
        assert.equal(metadata.width, 1024);
        assert.equal(metadata.height, 1024);
        assert.equal(
          (await agents[1].get(`/api/images/${saved.output_image_id}/content`))
            .status,
          404,
        );
        const history = await agents[0].get(
          `/api/jobs?project_id=${project.body.project.id}`,
        );
        assert(
          history.body.jobs.some((j: { id: string }) => j.id === saved.id),
        );
        const usage = await svc.admin
          .from("usage_events")
          .select("units,provider_usage,cost_estimate_micro_usd")
          .eq("job_id", saved.id)
          .eq("operation", "processing")
          .single();
        assert(!usage.error);
        assert.equal(usage.data.units, 1);
        console.log(
          JSON.stringify({
            check: "real_reference_edit",
            mode,
            status: "completed",
            provider_usage_present: !!usage.data.provider_usage,
            cost_estimate_present: usage.data.cost_estimate_micro_usd !== null,
          }),
        );
      }
    } finally {
      await app.locals.processing?.stop();
      for (const id of ownerIds) {
        const active = await svc.admin
          .from("processing_jobs")
          .select("id")
          .eq("user_id", id)
          .in("status", ["queued", "running", "persisting"]);
        if (active.error || active.data?.length) {
          console.log(
            JSON.stringify({
              check: "cleanup_pending",
              test_owner_id: id,
              reason: "active_job_retained",
            }),
          );
          continue;
        }
        const images = await svc.admin
          .from("images")
          .select("object_key")
          .eq("user_id", id);
        if (images.data?.length) {
          const removed = await svc.admin.storage
            .from("photos")
            .remove(images.data.map((i) => i.object_key));
          assert(!removed.error, "Test object cleanup requires attention.");
        }
        const removed = await svc.admin.auth.admin.deleteUser(id);
        assert(
          !removed.error,
          "Isolated test account cleanup requires attention.",
        );
      }
    }
  },
);
