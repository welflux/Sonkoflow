import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { processingRoutes } from "../../server/processing/routes.js";
const id = "11111111-1111-4111-8111-111111111111",
  owner = "22222222-2222-4222-8222-222222222222",
  source = "33333333-3333-4333-8333-333333333333",
  project = "44444444-4444-4444-8444-444444444444";
const parent = {
  id,
  project_id: project,
  input_image_id: source,
  output_image_id: "55555555-5555-4555-8555-555555555555",
  mode: "product",
  status: "completed",
  quality_state: "completed",
  quality: "high",
  settings: {
    background: "preserve",
    framing: "match",
    preserve_appearance: true,
    provider_consent: true,
    product_options: { operations: ["lighting"], preserve_arrangement: true },
  },
  instructions: "Keep original packaging",
};
function fixture(visible: boolean) {
  const mutations: any[] = [];
  const submissions: any[] = [];
  const identity = {
    userId: owner,
    client: {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: visible ? parent : null, error: null };
          },
        };
      },
    },
  };
  const engine = {
    quality: { retryLimit: 2 },
    async qualityReady() {
      return true;
    },
    admin: {
      async rpc(name: string, p: unknown) {
        mutations.push({ name, p });
        return { data: 1, error: null };
      },
    },
    async submit(input: any, who: any, retry: any) {
      submissions.push({ input, who, retry });
      return { ...parent, id: source, status: "queued" };
    },
  };
  const app = express();
  app.use(express.json());
  processingRoutes(app, engine as any, () => identity as any);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res
      .status(error.status ?? 400)
      .json({ error: { code: error.code ?? "invalid_request" } }),
  );
  return { app, mutations, submissions };
}
test("foreign or nonexistent review and retry records are denied before privileged mutations", async () => {
  const f = fixture(false);
  const decision = await request(f.app)
    .post(`/api/jobs/${id}/decision`)
    .send({
      decision: "approved",
      request_key: source,
      expected_revision: 0,
      reviewed: true,
    });
  assert.equal(decision.status, 404);
  const retry = await request(f.app)
    .post(`/api/jobs/${id}/quality-retry`)
    .send({
      submission_key: source,
      targets: ["labels_details"],
      instructions: "Keep print",
      provider_consent: true,
    });
  assert.equal(retry.status, 404);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.submissions.length, 0);
});
test("review decisions use the authenticated owner, explicit review and request revision", async () => {
  const f = fixture(true);
  const r = await request(f.app)
    .post(`/api/jobs/${id}/decision`)
    .send({
      decision: "rejected",
      request_key: source,
      expected_revision: 0,
      reviewed: true,
    });
  assert.equal(r.status, 200);
  assert.equal(f.mutations[0].p.owner, owner);
  assert.equal(f.mutations[0].p.job, id);
  assert.equal(
    (
      await request(f.app)
        .post(`/api/jobs/${id}/decision`)
        .send({
          decision: "approved",
          request_key: source,
          expected_revision: 0,
          reviewed: false,
        })
    ).status,
    400,
  );
  assert.equal(f.mutations.length, 1);
});
test("controlled retry reconstructs the original reference and preservation controls rather than trusting client overrides", async () => {
  const f = fixture(true);
  const body = {
    submission_key: source,
    targets: ["labels_details"],
    instructions: "Restore original print.",
    provider_consent: true,
  };
  const r = await request(f.app)
    .post(`/api/jobs/${id}/quality-retry`)
    .send(body);
  assert.equal(r.status, 202);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].input.input_image_id, parent.input_image_id);
  assert.equal(f.submissions[0].input.instructions, parent.instructions);
  assert.deepEqual(
    f.submissions[0].input.product_options,
    parent.settings.product_options,
  );
  assert.deepEqual(f.submissions[0].retry.targets, body.targets);
  assert.equal(
    (
      await request(f.app)
        .post(`/api/jobs/${id}/quality-retry`)
        .send({ ...body, input_image_id: parent.output_image_id })
    ).status,
    400,
  );
  assert.equal(f.submissions.length, 1);
});
