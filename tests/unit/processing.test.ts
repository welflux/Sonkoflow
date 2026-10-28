import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  jobInput,
  buildPrompt,
  outputSize,
} from "../../server/processing/contracts.js";
import {
  loadProcessingConfig,
  priceSnapshot,
} from "../../server/processing/config.js";
import {
  editImage,
  validateOutput,
  estimateCost,
  ProviderFailure,
  type Usage,
} from "../../server/processing/provider.js";
import {
  ProcessingWorker,
  type JobStore,
  type WorkerJob,
  type StoredImage,
} from "../../server/processing/engine.js";
import { hash } from "../../server/security.js";
const env = {
  AI_PROCESSING_ENABLED: "1",
  AI_OPENAI_API_KEY: "test-key-never-a-real-credential",
  AI_OPERATION_RESERVE_USD: "1",
  AI_USER_DAILY_BUDGET_USD: "5",
  AI_GLOBAL_DAILY_BUDGET_USD: "20",
  AI_PRICE_VERSION: "test-only-prices",
  AI_TEXT_INPUT_USD_PER_MILLION: "5",
  AI_IMAGE_INPUT_USD_PER_MILLION: "8",
  AI_TEXT_OUTPUT_USD_PER_MILLION: "10",
  AI_IMAGE_OUTPUT_USD_PER_MILLION: "32",
};
const config = loadProcessingConfig(env).config!;
const owner = "11111111-1111-4111-8111-111111111111",
  project = "22222222-2222-4222-8222-222222222222",
  sourceId = "33333333-3333-4333-8333-333333333333",
  jobId = "44444444-4444-4444-8444-444444444444";
const input = jobInput.parse({
  project_id: project,
  input_image_id: sourceId,
  submission_key: jobId,
  mode: "product",
  preserve_appearance: true,
  provider_consent: true,
});
const usage: Usage = {
  input_tokens: 50,
  output_tokens: 100,
  total_tokens: 150,
  input_tokens_details: { text_tokens: 10, image_tokens: 40 },
  output_tokens_details: { text_tokens: 0, image_tokens: 100 },
};
async function fixture() {
  const source = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#eee" },
  })
    .webp()
    .toBuffer();
  const generated = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "#aac" },
  })
    .webp()
    .toBuffer();
  const job: WorkerJob = {
    id: jobId,
    user_id: owner,
    project_id: project,
    input_image_id: sourceId,
    submission_key: jobId,
    mode: "product",
    instructions: "",
    quality: "high",
    settings: {
      background: "preserve",
      framing: "match",
      preserve_appearance: true,
    },
    model: config.AI_IMAGE_MODEL,
    output_size: "1024x1024",
    result_image_id: "55555555-5555-4555-8555-555555555555",
    output_image_id: null,
    status: "running",
    provider_started_at: null,
    price_snapshot: priceSnapshot(config),
  };
  const images = new Map<string, StoredImage>([
    [
      sourceId,
      {
        id: sourceId,
        user_id: owner,
        project_id: project,
        role: "original",
        status: "ready",
        object_key: `${owner}/${sourceId}.webp`,
        checksum: hash(source),
        width: 128,
        height: 128,
        byte_size: source.length,
      },
    ],
  ]);
  const objects = new Map([[`${owner}/${sourceId}.webp`, source]]);
  const steps: { action: string; p: Record<string, unknown> }[] = [];
  let claims = 0;
  let writes = 0;
  let failWrites = false;
  let failSource = false;
  const store: JobStore = {
    async claim() {
      return claims++ === 0 ? job : null;
    },
    async step(_id, _worker, action, p = {}) {
      steps.push({ action, p });
      if (action === "prepare") {
        images.set(job.result_image_id, {
          id: job.result_image_id,
          user_id: owner,
          project_id: project,
          role: "generated",
          status: "pending",
          object_key: `${owner}/${job.result_image_id}.webp`,
          checksum: p.checksum as string,
          width: 1024,
          height: 1024,
          byte_size: p.byte_size as number,
        });
        job.output_image_id = job.result_image_id;
      }
      return true;
    },
    async image(id, user) {
      const i = images.get(id);
      return i?.user_id === user ? i : null;
    },
    async read(key) {
      if (failSource && key.includes(sourceId)) throw new Error("source");
      const b = objects.get(key);
      if (!b) throw new Error("missing");
      return b;
    },
    async write(key, b) {
      writes++;
      if (failWrites) throw new Error("storage");
      objects.set(key, b);
    },
  };
  return {
    store,
    job,
    steps,
    generated,
    objects,
    images,
    get writes() {
      return writes;
    },
    set failWrites(v: boolean) {
      failWrites = v;
    },
    set failSource(v: boolean) {
      failSource = v;
    },
  };
}
test("processing configuration fails closed without enabled key, budgets and pricing; errors reveal names only", () => {
  assert.equal(loadProcessingConfig({}).config, null);
  const r = loadProcessingConfig({
    AI_PROCESSING_ENABLED: "1",
    AI_OPENAI_API_KEY: "",
  });
  assert.equal(r.config, null);
  assert(r.missing.includes("AI_OPENAI_API_KEY"));
  assert(!JSON.stringify(r).includes("secret"));
  assert(config);
});
test("three controlled modes preserve identity/product constraints and reject invalid instructions/settings", () => {
  for (const mode of ["personal", "portrait", "product"] as const) {
    const p = buildPrompt({
      ...input,
      mode,
      instructions: "Preserve the navy background.",
    });
    assert(p.includes(mode === "product" ? "labels" : "identity"));
    assert(p.includes("reference"));
  }
  assert.throws(() => jobInput.parse({ ...input, mode: "brand-studio" }));
  assert.throws(() =>
    jobInput.parse({ ...input, instructions: "x".repeat(1501) }),
  );
  assert.throws(() => jobInput.parse({ ...input, preserve_appearance: false }));
  assert.throws(() => jobInput.parse({ ...input, model: "uncontrolled" }));
  assert.equal(outputSize(input, 2000, 1000), "1536x1024");
  assert.equal(outputSize(input, 1000, 2000), "1024x1536");
});
test("real provider adapter sends only bounded reference editing parameters to the fixed OpenAI endpoint", async () => {
  let called = 0;
  const result = await editImage(
    config,
    input,
    Buffer.from("reference"),
    "1024x1024",
    jobId,
    new AbortController().signal,
    async (url, options) => {
      called++;
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        `Bearer ${config.AI_OPENAI_API_KEY}`,
      );
      const form = options!.body as FormData;
      assert.equal(form.get("n"), "1");
      assert.equal(form.get("output_format"), "webp");
      assert.equal(form.get("input_fidelity"), null);
      assert.equal(form.get("model"), config.AI_IMAGE_MODEL);
      assert(form.get("image") instanceof Blob);
      assert.equal(form.get("response_format"), null);
      return new Response(
        JSON.stringify({ data: [{ b64_json: "AAAA" }], usage }),
        { headers: { "x-request-id": "req-test" } },
      );
    },
  );
  assert.equal(called, 1);
  assert.deepEqual(result.usage, usage);
  assert.equal(result.requestId, "req-test");
});
test("provider 401/429, moderation rejection and network uncertainty remain distinct without automatic API retries", async () => {
  for (const [status, code, safe, uncertain] of [
    [401, "provider_credentials", true, false],
    [429, "provider_rate_limit", true, false],
    [400, "provider_rejected", false, false],
    [503, "provider_unavailable", false, true],
  ] as const) {
    let n = 0;
    await assert.rejects(
      editImage(
        config,
        input,
        Buffer.from("x"),
        "1024x1024",
        jobId,
        new AbortController().signal,
        async () => {
          n++;
          return new Response("{}", { status });
        },
      ),
      (e) =>
        e instanceof ProviderFailure &&
        e.code === code &&
        e.safe === safe &&
        e.uncertain === uncertain,
    );
    assert.equal(n, 1);
  }
  await assert.rejects(
    editImage(
      config,
      input,
      Buffer.from("x"),
      "1024x1024",
      jobId,
      new AbortController().signal,
      async () => {
        throw new Error("contains sensitive transport internals");
      },
    ),
    (e) =>
      e instanceof ProviderFailure &&
      e.uncertain &&
      !e.message.includes("sensitive"),
  );
});
test("billing exhaustion is distinct from rate limiting and never exposes provider error details or retries", async () => {
  for (const body of [
    JSON.stringify({
      error: {
        code: "credit_balance_exhausted",
        type: "insufficient_quota",
        message: "private billing detail",
      },
    }),
    JSON.stringify({ error: { code: "insufficient_quota" } }),
    JSON.stringify({ error: { code: "billing_hard_limit_reached" } }),
    JSON.stringify({ error: { type: "insufficient_quota" } }),
    "not-json",
    "x".repeat(8193),
  ]) {
    let calls = 0;
    const expected = body.startsWith("{")
      ? "provider_billing"
      : "provider_rate_limit";
    await assert.rejects(
      editImage(
        config,
        input,
        Buffer.from("reference"),
        "1024x1024",
        jobId,
        new AbortController().signal,
        async () => {
          calls++;
          return new Response(body, { status: 429 });
        },
      ),
      (e) =>
        e instanceof ProviderFailure &&
        e.code === expected &&
        e.safe &&
        !e.uncertain &&
        !e.message.includes("private"),
    );
    assert.equal(calls, 1);
  }
});
test("output validation rejects missing, corrupt, wrong-size and unsupported returned images", async () => {
  const f = await fixture();
  await validateOutput(f.generated.toString("base64"), "1024x1024");
  for (const bytes of [
    null,
    "not valid base64",
    Buffer.from("not image").toString("base64"),
    (await sharp(f.generated).resize(64).webp().toBuffer()).toString("base64"),
    (await sharp(f.generated).png().toBuffer()).toString("base64"),
  ])
    await assert.rejects(validateOutput(bytes, "1024x1024"));
});
test("provider usage estimates use immutable configured rates and missing usage is never a fabricated zero", () => {
  assert.equal(estimateCost(usage, priceSnapshot(config)), 3570);
  assert.equal(estimateCost(null, priceSnapshot(config)), null);
  assert.equal(
    estimateCost(
      { input_tokens: 50, output_tokens: 100, total_tokens: 150 },
      priceSnapshot(config),
    ),
    null,
  );
  assert.equal(estimateCost(usage, {}), null);
});
test("worker completes only after real output validation, durable metadata checkpoint and storage readback", async () => {
  const f = await fixture();
  let calls = 0;
  await new ProcessingWorker(f.store, config, async () => {
    calls++;
    return {
      encoded: f.generated.toString("base64"),
      usage,
      requestId: "req-test",
    };
  }).once();
  assert.equal(calls, 1);
  assert.deepEqual(
    f.steps.map((s) => s.action),
    ["dispatch", "response", "prepare", "complete"],
  );
  assert.equal(f.objects.size, 2);
  assert.equal(f.steps[1].p.cost, 3570);
});
test("source/storage failures do not invent success or replay billable provider calls", async () => {
  const a = await fixture();
  a.failSource = true;
  let calls = 0;
  await new ProcessingWorker(a.store, config, async () => {
    calls++;
    throw new Error();
  }).once();
  assert.equal(calls, 0);
  assert.equal(a.steps.at(-1)?.p.safe, true);
  const b = await fixture();
  b.failWrites = true;
  await new ProcessingWorker(b.store, config, async () => {
    calls++;
    return {
      encoded: b.generated.toString("base64"),
      usage,
      requestId: "req-x",
    };
  }).once();
  assert.equal(calls, 1);
  assert.equal(b.writes, 3);
  assert.equal(b.steps.at(-1)?.action, "prepare");
  assert(!b.steps.some((s) => s.action === "fail"));
  assert(!b.steps.some((s) => s.action === "complete"));
});
test("provider timeout is persisted as uncertain and invalid outputs still retain the reported usage", async () => {
  const a = await fixture();
  await new ProcessingWorker(a.store, config, async () => {
    throw new ProviderFailure("provider_interrupted", true, false);
  }).once();
  assert.equal(a.steps.at(-1)?.p.uncertain, true);
  const b = await fixture();
  await new ProcessingWorker(b.store, config, async () => ({
    encoded: null,
    usage,
    requestId: "req-x",
  })).once();
  assert.deepEqual(
    b.steps.map((s) => s.action),
    ["dispatch", "response", "fail"],
  );
  assert.equal(b.steps[1].p.cost, 3570);
  assert.equal(b.steps.at(-1)?.p.code, "invalid_output");
});
test("persisting recovery verifies the saved object without issuing a second generation", async () => {
  const f = await fixture();
  f.job.status = "persisting";
  f.job.output_image_id = f.job.result_image_id;
  f.images.set(f.job.result_image_id, {
    id: f.job.result_image_id,
    user_id: owner,
    project_id: project,
    role: "generated",
    status: "pending",
    object_key: `${owner}/${f.job.result_image_id}.webp`,
    checksum: hash(f.generated),
    width: 1024,
    height: 1024,
    byte_size: f.generated.length,
  });
  f.objects.set(`${owner}/${f.job.result_image_id}.webp`, f.generated);
  let calls = 0;
  await new ProcessingWorker(f.store, config, async () => {
    calls++;
    throw new Error();
  }).once();
  assert.equal(calls, 0);
  assert.deepEqual(
    f.steps.map((s) => s.action),
    ["complete"],
  );
});
