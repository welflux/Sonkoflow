import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import {
  packInput,
  outputSpecs,
  requestFingerprint,
} from "../../server/packs/contracts.js";
import { loadPackConfig } from "../../server/packs/config.js";
import { makePackPlan } from "../../server/packs/plan.js";
import { packProgress, PackService } from "../../server/packs/service.js";
import { imageZip, crc32 } from "../../server/packs/zip.js";
import {
  loadProcessingConfig,
  priceSnapshot,
} from "../../server/processing/config.js";
import { estimateCost } from "../../server/processing/provider.js";
import { buildPrompt } from "../../server/processing/contracts.js";
import { hash } from "../../server/security.js";
const id = "11111111-1111-4111-8111-111111111111",
  source = "22222222-2222-4222-8222-222222222222";
const c = loadProcessingConfig({
  AI_PROCESSING_ENABLED: "1",
  AI_OPENAI_API_KEY: "test-only-key",
  AI_OPERATION_RESERVE_USD: ".1",
  AI_USER_DAILY_BUDGET_USD: "10",
  AI_GLOBAL_DAILY_BUDGET_USD: "20",
  AI_PRICE_VERSION: "test-prices",
  AI_TEXT_INPUT_USD_PER_MILLION: "5",
  AI_IMAGE_INPUT_USD_PER_MILLION: "8",
  AI_IMAGE_OUTPUT_USD_PER_MILLION: "30",
}).config!;
const tokens = {
  model: c.AI_IMAGE_MODEL,
  version: "test-token-estimates",
  max_source_pixels: 25000000,
  input_image_tokens: 1000,
  output_image_tokens: {
    low: { square: 100, landscape: 200 },
    medium: { square: 500, landscape: 1000 },
    high: { square: 1000, landscape: 2000 },
  },
};
const pc = loadPackConfig({
  AI_PACKS_ENABLED: "1",
  AI_PACK_CREDIT_MICRO_USD: "1000",
  AI_PACK_TOKEN_ESTIMATES_JSON: JSON.stringify(tokens),
})!;
const input = packInput.parse({
  project_id: id,
  input_image_id: source,
  outputs: [
    { type: "listing", quality: "low" },
    { type: "wide", quality: "high" },
  ],
});
test("pack selections are bounded and cost plans reflect real model rates, selected canvas and quality", () => {
  assert.throws(() => packInput.parse({ ...input, outputs: [] }));
  assert.throws(() =>
    packInput.parse({
      ...input,
      outputs: [...input.outputs, input.outputs[0]],
    }),
  );
  const plan = makePackPlan(
    input,
    { width: 1024, height: 1024, checksum: "test" },
    c,
    null,
    pc,
    2,
  );
  assert.equal(plan.outputs.length, 2);
  const listing = plan.outputs.find((o) => o.type === "listing")!,
    wide = plan.outputs.find((o) => o.type === "wide")!;
  assert(wide.estimated_micro_usd > listing.estimated_micro_usd);
  assert(plan.reserved_credits >= plan.estimated_credits);
  assert.equal(wide.job.output_size, "1536x1024");
  assert.equal(listing.job.settings.pack_context.type, "listing");
  assert.equal(
    requestFingerprint(input),
    requestFingerprint({ ...input, outputs: [...input.outputs].reverse() }),
  );
  assert.throws(() =>
    makePackPlan(
      input,
      { width: 8192, height: 8192, checksum: "test" },
      c,
      null,
      pc,
      2,
    ),
  );
  assert.equal(
    loadPackConfig({
      AI_PACKS_ENABLED: "1",
      AI_PACK_TOKEN_ESTIMATES_JSON: "broken",
    }),
    null,
  );
  assert.throws(() =>
    makePackPlan(
      input,
      { width: 1024, height: 1024, checksum: "test" },
      { ...c, AI_IMAGE_MODEL: "gpt-image-1.5" },
      null,
      pc,
      2,
    ),
  );
});
test("every pack direction keeps the original product reference and creative/detail exceptions stay explicit", () => {
  for (const type of [
    "listing",
    "lifestyle",
    "detail",
    "social",
    "wide",
  ] as const) {
    const plan = makePackPlan(
      { ...input, outputs: [{ type, quality: "high" }] },
      { width: 1024, height: 1024, checksum: "x" },
      c,
      null,
      pc,
      2,
    ).outputs[0];
    const prompt = buildPrompt({
      ...plan.job,
      background: "clean",
      product_options: plan.job.settings.product_options,
      pack_context: plan.job.settings.pack_context,
    });
    assert(prompt.includes("original uploaded photograph"));
    assert(prompt.includes("packaging"));
    assert(prompt.includes(outputSpecs[type].name));
    if (type === "detail")
      assert(prompt.includes("never reconstruct unseen features"));
    if (type === "lifestyle" || type === "wide") {
      assert(prompt.includes("environmental elements"));
      assert(!prompt.includes("Do not create a lifestyle scene"));
    }
  }
});
test("partial and retry failures retain prior successful approved versions without invented progress", () => {
  const pack = {
    configuration: { outputs: [{ type: "listing" }, { type: "wide" }] },
  };
  const jobs = [
    {
      id: "old",
      pack_output_type: "listing",
      status: "completed",
      output_image_id: "photo",
      user_decision: "approved",
      quality_retry_number: 0,
    },
    {
      id: "retry",
      pack_output_type: "listing",
      status: "failed",
      quality_retry_number: 1,
    },
    {
      id: "next",
      pack_output_type: "wide",
      status: "queued",
      quality_retry_number: 0,
    },
  ];
  const result = packProgress(pack, jobs);
  assert.equal(result.progress.completed, 1);
  assert.equal(result.progress.failed, 1);
  assert.equal(result.progress.pending, 1);
  assert.equal(result.progress.approved, 1);
  assert.equal(result.outputs[0].approved.id, "old");
  assert.equal(result.outputs[0].current.id, "retry");
  const missing = packProgress(
    pack,
    jobs.filter((j) => j.pack_output_type !== "wide"),
  );
  assert.equal(missing.progress.missing, 1);
  assert.equal(missing.progress.pending, 0);
  assert.equal(missing.status, "incomplete");
});
test("verified image-only usage can be reconciled without inventing an output token breakdown for other models", () => {
  const usage = {
    input_tokens: 50,
    output_tokens: 100,
    total_tokens: 150,
    input_tokens_details: { text_tokens: 10, image_tokens: 40 },
  };
  assert.equal(estimateCost(usage, priceSnapshot(c)), 3370);
  assert.equal(
    estimateCost(usage, { ...priceSnapshot(c), output_modality: undefined }),
    null,
  );
  assert.equal(
    estimateCost(usage, { ...priceSnapshot(c), model: "unverified" }),
    null,
  );
});
test("ZIP entries are safe, bounded, CRC-valid and readable by an independent standard ZIP reader", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const bytes = imageZip([
    { name: "01-listing-test.webp", bytes: Buffer.from("actual saved bytes") },
  ]);
  const result = execFileSync(
    "python3",
    [
      "-c",
      "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(z.read('01-listing-test.webp').decode())",
    ],
    { input: bytes },
  )
    .toString()
    .trim();
  assert.equal(result, "actual saved bytes");
  assert.throws(() =>
    imageZip([{ name: "../secret.webp", bytes: Buffer.from("x") }]),
  );
  assert.throws(() => imageZip([]));
  assert.throws(() =>
    imageZip([{ name: "a.webp", bytes: Buffer.alloc(11 * 1024 * 1024) }]),
  );
  assert.throws(() =>
    imageZip([
      { name: "a.webp", bytes: Buffer.from("1") },
      { name: "a.webp", bytes: Buffer.from("2") },
    ]),
  );
});
test("ZIP export validates real stored image bytes and rechecks approval after I/O", async () => {
  const bytes = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "navy" },
    })
      .webp()
      .toBuffer(),
    job = {
      id,
      output_image_id: source,
      output_size: "1024x1024",
      decision_revision: 1,
    };
  const service = new PackService(
    { admin: {} } as any,
    {
      async read() {
        return bytes;
      },
    } as any,
  );
  const result = { outputs: [{ type: "listing", approved: job }] };
  service.get = async () => result as any;
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return {
            data: {
              id: source,
              role: "generated",
              status: "ready",
              object_key: "private-key",
              checksum: hash(bytes),
            },
            error: null,
          };
        },
      };
    },
  };
  const zip = await service.zip(id, { client } as any);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  let n = 0;
  service.get = async () => {
    n++;
    return (
      n === 1 ? result : { outputs: [{ type: "listing", approved: null }] }
    ) as any;
  };
  await assert.rejects(
    service.zip(id, { client } as any),
    (e: any) => e.code === "pack_changed",
  );
  service.get = async () => result as any;
  const broken = new PackService(
    { admin: {} } as any,
    {
      async read() {
        return Buffer.from("corrupt");
      },
    } as any,
  );
  broken.get = service.get;
  await assert.rejects(
    broken.zip(id, { client } as any),
    (e: any) => e.code === "pack_storage_unavailable",
  );
});
function serviceFixture({ sourceVisible = true, prior = null as any } = {}) {
  const mutations: any[] = [];
  const engine = {
    config: c,
    packConfig: pc,
    quality: { vision: null, retryLimit: 2 },
    async packsReady() {
      return true;
    },
    async qualityReady() {
      return true;
    },
    async start() {},
    worker: { wake() {} },
    admin: {
      async rpc(name: string, p: any) {
        mutations.push({ name, p });
        return {
          data: name === "create_product_pack" ? { id } : null,
          error: null,
        };
      },
    },
  };
  const identity = {
    userId: id,
    client: {
      from(table: string) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              error: null,
              data:
                table === "product_packs"
                  ? prior
                  : table === "images"
                    ? sourceVisible
                      ? {
                          id: source,
                          project_id: id,
                          role: "original",
                          status: "ready",
                          width: 1024,
                          height: 1024,
                          checksum: "source",
                        }
                      : null
                    : {
                        balance_credits: 10000,
                        reserved_credits: 0,
                        unit_micro_usd: 1000,
                      },
            };
          },
        };
      },
    },
  };
  return {
    service: new PackService(engine as any),
    identity: identity as any,
    mutations,
    engine,
  };
}
test("foreign originals and stale quotes cannot start or reserve a pack; quotes do not expose internal job plans", async () => {
  const denied = serviceFixture({ sourceVisible: false });
  await assert.rejects(
    denied.service.quote(input, denied.identity),
    (e: any) => e.status === 404,
  );
  assert.equal(denied.mutations.length, 0);
  const f = serviceFixture();
  const quote = await f.service.quote(input, f.identity);
  assert(quote.can_generate);
  assert(!("job" in quote.outputs[0]));
  assert(!JSON.stringify(quote).includes("test-only-key"));
  await assert.rejects(
    f.service.create(
      {
        ...input,
        submission_key: source,
        quote_fingerprint: "f".repeat(64),
        provider_consent: true,
      },
      f.identity,
    ),
    (e: any) => e.code === "pack_quote_stale",
  );
  assert.equal(
    f.mutations.filter((m) => m.name === "create_product_pack").length,
    0,
  );
  const pack = await f.service.create(
    {
      ...input,
      submission_key: source,
      quote_fingerprint: quote.quote_fingerprint,
      provider_consent: true,
    },
    f.identity,
  );
  assert.equal(pack.id, id);
  const called = f.mutations.find((m) => m.name === "create_product_pack");
  assert(
    called.p.jobs.every(
      (j: any) => j.settings.pack_context && j.pack_credit_plan,
    ),
  );
  assert.equal(called.p.p.user_id, id);
});
test("a lost-response duplicate returns its owned existing pack even if new generation is disabled", async () => {
  const f = serviceFixture({
    prior: { id, request_fingerprint: requestFingerprint(input) },
  });
  f.engine.config = null as any;
  const result = await f.service.create(
    {
      ...input,
      submission_key: source,
      quote_fingerprint: "f".repeat(64),
      provider_consent: true,
    },
    f.identity,
  );
  assert.equal(result.id, id);
  assert.equal(f.mutations.length, 0);
});
