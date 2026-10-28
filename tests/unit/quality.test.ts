import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { hash } from "../../server/security.js";
import { jobInput, buildPrompt } from "../../server/processing/contracts.js";
import {
  productOptions,
  report,
  retryDirection,
  unavailable,
} from "../../server/quality/contracts.js";
import { qualityConfig } from "../../server/quality/config.js";
import { localAssessment } from "../../server/quality/analysis.js";
import {
  assessWithVision,
  visionCost,
  type VisionResult,
} from "../../server/quality/vision.js";
import {
  QualityWorker,
  type QualityStore,
  type QualityJob,
} from "../../server/quality/worker.js";
const options = productOptions.parse({});
const config = {
  AI_OPENAI_API_KEY: "test-not-real-key",
  AI_QUALITY_VISION_MODEL: "gpt-6.1-terra" as const,
  AI_QUALITY_RESERVE_USD: 0.03,
  AI_QUALITY_INPUT_USD_PER_MILLION: 1,
  AI_QUALITY_OUTPUT_USD_PER_MILLION: 5,
  AI_QUALITY_PRICE_VERSION: "test-prices",
};
const productSvg = (kind: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eee"/><rect x="60" y="45" width="${kind === "packaging" ? 150 : 110}" height="170" rx="8" fill="#28566e"/><rect x="68" y="100" width="90" height="55" fill="white"/><text x="75" y="122" font-size="14">REAL 250ml</text>${kind === "reflective" ? '<path d="M75 52L105 52L130 210L100 210Z" fill="white" opacity=".4"/>' : ""}${kind === "multiple" ? '<circle cx="192" cy="192" r="30" fill="#af9445"/>' : ""}</svg>`,
  );
async function fixture(kind = "labels") {
  const source = await sharp(productSvg(kind)).webp().toBuffer();
  const output = await sharp(source)
    .resize(1024, 1024)
    .webp({ lossless: true })
    .toBuffer();
  return { source, output };
}
const checks = [
  "framing",
  "shape_color",
  "labels_details",
  "background_requirements",
].map((id) => ({
  id,
  status: "passed",
  confidence: "medium",
  explanation: "No large visible change in this test fixture.",
}));
test("product operation/region controls are validated and preservation instructions are subordinate to the original", () => {
  assert.throws(() => productOptions.parse({ operations: [] }));
  assert.throws(() => productOptions.parse({ operations: ["color", "color"] }));
  assert.throws(() =>
    productOptions.parse({
      region: { left: 0.9, top: 0, width: 0.3, height: 0.5 },
    }),
  );
  const p = buildPrompt({
    mode: "product",
    instructions: "invent new logo",
    background: "preserve",
    product_options: productOptions.parse({ operations: ["lighting"] }),
  });
  for (const phrase of [
    "actual shape",
    "quantity",
    "printed text",
    "Never invent text",
    "Keep the original background unchanged",
    "Only these operations are authorized: lighting",
  ])
    assert(p.includes(phrase));
  assert(
    retryDirection(["labels_details"], "Fix the label").includes(
      "ORIGINAL reference",
    ),
  );
  assert.equal(qualityConfig({ AI_PRODUCT_RETRY_LIMIT: "-1" }).retryLimit, 0);
  assert.equal(qualityConfig({ AI_QUALITY_VISION_ENABLED: "1" }).vision, null);
  const base = {
    project_id: "11111111-1111-4111-8111-111111111111",
    input_image_id: "22222222-2222-4222-8222-222222222222",
    submission_key: "33333333-3333-4333-8333-333333333333",
    preserve_appearance: true,
    provider_consent: true,
    product_options: options,
  };
  assert.throws(() => jobInput.parse({ ...base, mode: "personal" }));
  assert.throws(() =>
    jobInput.parse({
      ...base,
      mode: "product",
      background: "clean",
      product_options: { operations: ["lighting"] },
    }),
  );
});
test("real local descriptors run on labeled, complex-packaging, reflective and multiple-item fixtures without inventing a fidelity score", async () => {
  for (const kind of ["labels", "packaging", "reflective", "multiple"]) {
    const f = await fixture(kind),
      r = await localAssessment(f.source, f.output, "1024x1024", options);
    assert.equal(r.checks.length, 4);
    assert(r.checks.slice(0, 2).every((c) => c.status === "passed"));
    assert(
      r.checks
        .filter((c) => c.method === "heuristic")
        .every((c) => c.confidence === null),
    );
    assert(!("score" in r));
    assert.equal(
      report([...r.checks, unavailable("Human label verification required.")])
        .status,
      "needs_review",
    );
  }
  const f = await fixture();
  assert.equal(
    (
      await localAssessment(
        f.source,
        Buffer.from("broken"),
        "1024x1024",
        options,
      )
    ).status,
    "failed",
  );
  assert.equal(
    (
      await localAssessment(f.source, f.output, "1536x1024", options)
    ).checks.find((c) => c.id === "canvas")?.status,
    "failed",
  );
  const altered = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "red" },
  })
    .webp()
    .toBuffer();
  const r = await localAssessment(f.source, altered, "1024x1024", options);
  assert.equal(
    r.checks.find((c) => c.id === "color_distribution")?.status,
    "needs_review",
  );
});
test("vision assessment uses private inline images, bounded output, fixed endpoint and uncertain findings are not confirmed defects", async () => {
  const f = await fixture();
  let calls = 0;
  const result = await assessWithVision(
    config,
    f.source,
    f.output,
    options,
    "clean",
    "keep labels",
    "job-test",
    new AbortController().signal,
    async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      const body = JSON.parse(init?.body as string);
      assert.equal(body.model, "gpt-6.1-terra");
      assert.equal(body.max_completion_tokens, 1500);
      assert.equal(body.reasoning_effort, "none");
      assert.equal(body.response_format.json_schema.strict, true);
      assert(
        body.messages[1].content[1].image_url.url.startsWith(
          "data:image/webp;base64,",
        ),
      );
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  checks: checks.map((c) =>
                    c.id === "labels_details"
                      ? { ...c, status: "failed", confidence: "low" }
                      : c.id === "shape_color"
                        ? { ...c, confidence: "low" }
                        : c,
                  ),
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
        { headers: { "x-request-id": "req-test" } },
      );
    },
  );
  assert.equal(calls, 1);
  assert.equal(
    result.checks?.find((c) => c.id === "labels_details")?.status,
    "needs_review",
  );
  assert.equal(visionCost(result.usage, { input: 1, output: 5 }), 350);
  assert.equal(
    result.checks?.find((c) => c.id === "shape_color")?.status,
    "needs_review",
  );
  assert.equal(visionCost(null, { input: 1, output: 5 }), null);
});
test("invalid/refused assessment retains real usage; provider rejection and oversized bodies never fabricate findings or retry", async () => {
  const f = await fixture();
  const r = await assessWithVision(
    config,
    f.source,
    f.output,
    options,
    "clean",
    "",
    "test",
    new AbortController().signal,
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "stop", message: { content: "not valid JSON" } },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
      ),
  );
  assert.equal(r.checks, null);
  assert.equal(r.usage?.input_tokens, 100);
  for (const response of [
    () => new Response("{}", { status: 429 }),
    () => new Response("x".repeat(65537)),
  ]) {
    let count = 0;
    await assert.rejects(
      assessWithVision(
        config,
        f.source,
        f.output,
        options,
        "clean",
        "",
        "test",
        new AbortController().signal,
        async () => {
          count++;
          return response();
        },
      ),
    );
    assert.equal(count, 1);
  }
});
async function workerFixture(model: string | null = null) {
  const f = await fixture();
  const job: QualityJob = {
    id: "job",
    user_id: "owner",
    input_image_id: "source",
    output_image_id: "output",
    output_size: "1024x1024",
    settings: { background: "clean", product_options: options },
    instructions: "Keep packaging",
    quality_model: model,
    quality_price_snapshot: { input: 1, output: 5 },
  };
  let claimed = false;
  const steps: { action: string; p: Record<string, unknown> }[] = [];
  const store: QualityStore = {
    async claim() {
      if (claimed) return null;
      claimed = true;
      return job;
    },
    async step(_j, _w, action, p = {}) {
      steps.push({ action, p });
      return true;
    },
    async read(key) {
      return key === "source" ? f.source : f.output;
    },
    async image(id) {
      return {
        id,
        user_id: "owner",
        project_id: "project",
        object_key: id,
        checksum: hash(id === "source" ? f.source : f.output),
        role: id === "source" ? "original" : "generated",
        status: "ready",
        width: 1024,
        height: 1024,
        byte_size: 1000,
      };
    },
  };
  return { store, steps, f, job };
}
test("local assessments do not call a provider and never automatically approve the saved result", async () => {
  const f = await workerFixture();
  let calls = 0;
  await new QualityWorker(f.store, null, async () => {
    calls++;
    throw new Error();
  }).once();
  assert.equal(calls, 0);
  assert.deepEqual(
    f.steps.map((s) => s.action),
    ["local", "complete"],
  );
  const r = f.steps.at(-1)!.p.report as any;
  assert.equal(r.status, "needs_review");
  assert(!("user_decision" in r));
});
test("assessment failures retain local checks and the existing result; storage and provider failures cannot trigger image regeneration", async () => {
  const f = await workerFixture("gpt-6.1-terra");
  let calls = 0;
  await new QualityWorker(f.store, config, async () => {
    calls++;
    throw new Error("sensitive internal error");
  }).once();
  assert.equal(calls, 1);
  assert.deepEqual(
    f.steps.map((s) => s.action),
    ["local", "dispatch", "unavailable"],
  );
  assert(!JSON.stringify(f.steps).includes("sensitive"));
  assert((f.steps.at(-1)!.p.report as any).checks.length >= 5);
  const broken = await workerFixture();
  broken.store.read = async () => {
    throw new Error("private URL");
  };
  await new QualityWorker(broken.store, null).once();
  assert.deepEqual(
    broken.steps.map((s) => s.action),
    ["unavailable"],
  );
});
test("vision usage is checkpointed before findings and database acknowledgement retries never repeat the provider", async () => {
  const f = await workerFixture("gpt-6.1-terra");
  let calls = 0,
    lost = true;
  const step = f.store.step;
  f.store.step = async (j, w, a, p) => {
    if (a === "response" && lost) {
      lost = false;
      throw new Error("lost acknowledgement");
    }
    return step(j, w, a, p);
  };
  await new QualityWorker(f.store, config, async () => {
    calls++;
    return {
      checks: null,
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      requestId: "req-test",
    };
  }).once();
  assert.equal(calls, 1);
  assert.deepEqual(
    f.steps.map((s) => s.action),
    ["local", "dispatch", "response", "unavailable"],
  );
  assert.equal(f.steps.find((s) => s.action === "response")!.p.cost, 350);
});
