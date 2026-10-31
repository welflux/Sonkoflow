// Contract fixtures only. These tests do not claim live provider operation or
// photographic quality and never contact a real provider or use real API keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { jobInput, fingerprint } from "../../server/processing/contracts.js";
import {
  loadEngineRegistry,
  chooseRoute,
  engineCapabilities,
  routeDigest,
  topazModel,
  ADAPTER_VERSION,
} from "../../server/processing/engine-registry.js";
import {
  processRemote,
  allowedOutputURL,
} from "../../server/processing/remote-providers.js";
import { loadProcessingConfig } from "../../server/processing/config.js";
import { ProviderFailure } from "../../server/processing/provider.js";
import {
  ProcessingWorker,
  ProcessingEngine,
  supabaseJobStore,
  type WorkerJob,
  type JobStore,
} from "../../server/processing/engine.js";
import { meterPlan } from "../../server/billing/meter.js";
import { hash } from "../../server/security.js";
const rate = {
  version: "unit-tests-only",
  unit: "output_megapixel",
  micro_usd: 1000,
  minimum_micro_usd: 100,
  max_output_pixels: 25_000_000,
  reserve_multiplier: 2,
};
const base = {
  project_id: "11111111-1111-4111-8111-111111111111",
  input_image_id: "22222222-2222-4222-8222-222222222222",
  submission_key: "33333333-3333-4333-8333-333333333333",
  mode: "personal",
  background: "preserve",
  framing: "match",
  preserve_appearance: true,
  provider_consent: true,
};
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "sonko-engines-"));
  const env: NodeJS.ProcessEnv = {
    AI_MULTI_ENGINE_ENABLED: "1",
    AI_TOPAZ_ENABLED: "1",
    AI_CLAID_ENABLED: "1",
    AI_TOPAZ_API_KEY: "test-only-topaz",
    AI_CLAID_API_KEY: "test-only-claid",
    AI_TOPAZ_OUTPUT_PREFIXES: "https://downloads.example.test/results/",
    AI_TOPAZ_PRICE_JSON: JSON.stringify(rate),
    AI_CLAID_PRICE_JSON: JSON.stringify({ ...rate, unit: "operation" }),
  };
  for (const provider of ["topaz", "claid"]) {
    const samples = [
      "enhance:1",
      "upscale:2",
      "upscale:4",
      "sharpen:1",
      "denoise:1",
      "product_finish:1",
    ].flatMap((key) =>
      ["portrait", "product", "commercial"].map((category) => ({
        category,
        model:
          provider === "topaz"
            ? topazModel(key.split(":")[0])
            : "claid-edit-v1",
        operation: key.split(":")[0],
        scale: Number(key.split(":")[1]),
        source_sha256: (
          { portrait: "a", product: "b", commercial: "c" } as Record<
            string,
            string
          >
        )[category].repeat(64),
        output_sha256: "b".repeat(64),
        output_pixels: 4096,
        status: "completed",
        live_request_id: "contract-fixture-not-a-real-call",
        identity_review: "passed",
        detail_review: "passed",
        naturalness_review: "passed",
        actual_cost_micro_usd: 100,
        invoice_reference: "unit-test-only-invoice",
        elapsed_ms: 1,
      })),
    );
    const file = path.join(directory, provider + ".json");
    writeFileSync(
      file,
      JSON.stringify({
        version: ADAPTER_VERSION,
        provider,
        model:
          provider === "topaz" ? "Upscale High Fidelity V3" : "claid-edit-v1",
        price_version: rate.version,
        approved: true,
        samples,
      }),
    );
    env["AI_" + provider.toUpperCase() + "_VERIFICATION_FILE"] = file;
  }
  return {
    env,
    registry: loadEngineRegistry(env),
    directory,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
function input(engine = "topaz", operation = "enhance", scale = 1) {
  return jobInput.parse({
    ...base,
    processing: {
      experience: "authentic",
      engine,
      operation,
      scale,
      consented_engine: engine,
    },
  });
}
const common = {
  AI_PROCESSING_ENABLED: "1",
  AI_OPERATION_RESERVE_USD: "1",
  AI_USER_DAILY_BUDGET_USD: "5",
  AI_GLOBAL_DAILY_BUDGET_USD: "20",
};

test("new engines fail closed, expose no keys, and preserve legacy fingerprints", () => {
  const registry = loadEngineRegistry({});
  assert.equal(registry.engines.topaz.enabled, false);
  assert.equal(registry.engines.claid.enabled, false);
  const old = jobInput.parse(base);
  assert.equal("processing" in old, false);
  assert.equal(
    chooseRoute(registry, old, { width: 64, height: 64 }, "legacy-model"),
    null,
  );
  const { submission_key, acknowledge_uncertain, ...content } = old;
  assert.equal(fingerprint(old), hash(JSON.stringify(content)));
  assert.doesNotMatch(
    JSON.stringify(engineCapabilities(registry)),
    /API_KEY|key"/,
  );
  assert.throws(
    () => chooseRoute(registry, input(), { width: 64, height: 64 }, "legacy"),
    /processing_engine_disabled/,
  );
});
test("enable flags and credentials cannot bypass missing live quality and invoice evidence", () => {
  const f = fixture();
  try {
    const env = { ...f.env, AI_TOPAZ_VERIFICATION_FILE: "" };
    assert.equal(
      loadEngineRegistry(env).engines.topaz.reason,
      "live_validation_required",
    );
    const p = JSON.parse(requireFile(f.env.AI_TOPAZ_VERIFICATION_FILE!));
    p.samples.forEach((s: any) => (s.actual_cost_micro_usd = null));
    writeFileSync(f.env.AI_TOPAZ_VERIFICATION_FILE!, JSON.stringify(p));
    assert.equal(loadEngineRegistry(f.env).engines.topaz.enabled, false);
  } finally {
    f.cleanup();
  }
});
function requireFile(file: string) {
  return readFileSync(file, "utf8");
}
import { readFileSync } from "node:fs";
test("authentic routes preserve native aspect, bind provider consent, and pin stable immutable costs", () => {
  const f = fixture();
  try {
    const route = chooseRoute(
      f.registry,
      input(),
      { width: 80, height: 64 },
      "legacy",
    )!;
    assert.equal(route.size, "80x64");
    assert.equal(route.provider, "topaz");
    assert.equal(route.reserve_micro_usd, 200);
    assert.equal(
      routeDigest(JSON.parse(JSON.stringify(route))),
      route.route_hash,
    );
    const reordered = JSON.parse(JSON.stringify(route));
    reordered.rate = Object.fromEntries(
      Object.entries(reordered.rate).reverse(),
    );
    assert.equal(routeDigest(reordered), route.route_hash);
    assert.throws(
      () =>
        chooseRoute(
          f.registry,
          jobInput.parse({
            ...base,
            processing: {
              experience: "authentic",
              engine: "auto",
              consented_engine: "claid",
            },
          }),
          { width: 64, height: 64 },
          "legacy",
        ),
      /processing_consent_changed/,
    );
  } finally {
    f.cleanup();
  }
});
test("authentic operations reject generation, changed backgrounds, cropping, prompts, product controls and brand overlays", () => {
  const f = fixture();
  try {
    for (const patch of [
      { background: "clean" },
      { framing: "square" },
      { instructions: "make a different face" },
      { mode: "product", product_options: { operations: ["lighting"] } },
    ])
      assert.throws(
        () =>
          chooseRoute(
            f.registry,
            jobInput.parse({ ...input(), ...patch }),
            { width: 64, height: 64 },
            "legacy",
          ),
        /authentic_operation/,
      );
    assert.throws(
      () =>
        chooseRoute(
          f.registry,
          input("openai"),
          { width: 64, height: 64 },
          "legacy",
        ),
      /authentic_operation/,
    );
    assert.throws(() =>
      jobInput.parse({
        ...base,
        processing: {
          ...input().processing,
          model: "Wonder 4",
          url: "http://localhost",
        },
      }),
    );
  } finally {
    f.cleanup();
  }
});
test("fallback is restricted to available verified operations before dispatch and requires the actual provider consent", () => {
  const f = fixture();
  try {
    f.registry.engines.topaz.enabled = false;
    const request = jobInput.parse({
      ...base,
      processing: {
        experience: "authentic",
        engine: "auto",
        operation: "upscale",
        scale: 2,
        consented_engine: "claid",
      },
    });
    assert.equal(
      chooseRoute(f.registry, request, { width: 64, height: 64 }, "legacy")!
        .provider,
      "claid",
    );
    assert.throws(
      () =>
        chooseRoute(
          f.registry,
          jobInput.parse({
            ...request,
            processing: { ...request.processing, consented_engine: "topaz" },
          }),
          { width: 64, height: 64 },
          "legacy",
        ),
      /processing_consent_changed/,
    );
    f.registry.engines.claid.verifiedCases = [];
    assert.throws(
      () =>
        chooseRoute(f.registry, request, { width: 64, height: 64 }, "legacy"),
      /processing_engine_disabled/,
    );
  } finally {
    f.cleanup();
  }
});
test("reviewed resolution limits and per-operation evidence are enforced before an API request", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        chooseRoute(
          f.registry,
          input("topaz", "upscale", 4),
          { width: 3000, height: 3000 },
          "legacy",
        ),
      /processing_dimensions/,
    );
    f.registry.engines.topaz.verifiedCases = ["upscale:2"];
    assert.throws(
      () =>
        chooseRoute(f.registry, input(), { width: 64, height: 64 }, "legacy"),
      /processing_engine_disabled/,
    );
  } finally {
    f.cleanup();
  }
});
test("OpenAI can be disabled independently without requiring an OpenAI key or invented token rates", () => {
  const c = loadProcessingConfig({ ...common, AI_OPENAI_ENABLED: "0" });
  assert.ok(c.config);
  assert.equal(c.config.AI_OPENAI_API_KEY, "");
  assert.equal(loadProcessingConfig({ ...common }).config, null);
  assert.equal(loadProcessingConfig({}).config, null);
});
test("remote output URLs reject alternate buckets, credentials, localhost, IPs and redirect targets", () => {
  const f = fixture();
  try {
    for (const url of [
      "http://downloads.example.test/results/image.png",
      "https://downloads.example.test/private/x",
      "https://user:password@downloads.example.test/results/x",
      "https://127.0.0.1/results/x",
      "https://localhost/results/x",
      "https://storage.googleapis.com/another-bucket/x",
    ])
      assert.throws(
        () => allowedOutputURL(url, f.registry.engines.topaz),
        ProviderFailure,
      );
    assert.equal(
      allowedOutputURL(
        "https://downloads.example.test/results/image.png?signature=abc",
        f.registry.engines.topaz,
      ),
      "https://downloads.example.test/results/image.png?signature=abc",
    );
  } finally {
    f.cleanup();
  }
});
async function image(width = 64, height = 64) {
  return sharp({
    create: { width, height, channels: 3, background: "#b8ddec" },
  })
    .png()
    .toBuffer();
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": "test-request",
    },
  });
}
test("Topaz sends one precision request, records acceptance before polling, fetches output without credentials and preserves source pixels", async () => {
  const f = fixture();
  try {
    const original = await image(),
      before = hash(original),
      route = chooseRoute(
        f.registry,
        input(),
        { width: 64, height: 64 },
        "legacy",
      )!,
      events: string[] = [];
    const fetcher = (async (url: any, init: any) => {
      const target = String(url);
      events.push(
        init?.method === "POST"
          ? "post"
          : target.includes("/status/")
            ? "status"
            : target.includes("/download/")
              ? "download"
              : "output",
      );
      assert.equal(init.redirect, "error");
      if (init.method === "POST") {
        const form = init.body as FormData;
        assert.equal(form.get("model"), "Upscale High Fidelity V3");
        assert.equal(form.get("recoveryStrength"), "0");
        assert.equal(form.get("outputWidth"), "64");
        assert.equal(form.get("cropToFill"), "false");
        assert.equal((init.headers as any)["X-API-KEY"], "test-only-topaz");
        return response({ process_id: "test-process" });
      }
      if (target.includes("/status/")) return response({ status: "Completed" });
      if (target.includes("/download/"))
        return response({
          download_url: "https://downloads.example.test/results/out.png",
        });
      assert.equal(init.headers, undefined);
      assert.equal(init.credentials, "omit");
      return new Response(new Uint8Array(original));
    }) as typeof fetch;
    const result = await processRemote(
      f.registry.engines.topaz,
      route,
      original,
      new AbortController().signal,
      async () => {
        events.push("receipt");
      },
      fetcher,
      async () => {},
    );
    assert.deepEqual(events, [
      "post",
      "receipt",
      "status",
      "download",
      "output",
    ]);
    assert.equal(hash(original), before);
    assert.equal(result.engineUsage.actual_cost_micro_usd, null);
    assert.equal(result.estimatedCost, 100);
    assert.ok(result.encoded);
  } finally {
    f.cleanup();
  }
});
test("Claid authentic and creative requests have distinct fixed operations with no outpaint or face-generation settings", async () => {
  const f = fixture();
  try {
    for (const creative of [false, true]) {
      const request = creative
        ? jobInput.parse({
            ...base,
            mode: "product",
            background: "clean",
            processing: {
              experience: "creative",
              engine: "claid",
              operation: "product_finish",
              consented_engine: "claid",
            },
          })
        : input("claid", "upscale", 2);
      const route = chooseRoute(
        f.registry,
        request,
        { width: 64, height: 64 },
        "legacy",
      )!;
      const out = await image(creative ? 64 : 128, creative ? 64 : 128);
      let posts = 0;
      const fetcher = (async (url: any, init: any) => {
        if (init.method === "POST") {
          posts++;
          const blob = init.body.get("data") as Blob;
          const payload = JSON.parse(await blob.text());
          assert.equal(payload.output.format, "png");
          assert.equal(payload.operations.resizing.fit, "bounds");
          assert.equal(payload.operations.background.remove, creative);
          assert.equal(!!payload.operations.restorations, !creative);
          assert.equal(!!payload.operations.adjustments, creative);
          return response({
            data: {
              output: {
                tmp_url:
                  "https://storage.googleapis.com/production-leapi-tmp-public/fixture/out.png",
              },
            },
          });
        }
        assert.equal(init.headers, undefined);
        return new Response(new Uint8Array(out));
      }) as typeof fetch;
      const result = await processRemote(
        f.registry.engines.claid,
        route,
        await image(),
        new AbortController().signal,
        undefined,
        fetcher,
      );
      assert.equal(posts, 1);
      assert.equal(result.engineUsage.provider, "claid");
    }
  } finally {
    f.cleanup();
  }
});
test("interrupted or accepted provider calls never trigger a second provider submission", async () => {
  const f = fixture();
  try {
    const route = chooseRoute(
      f.registry,
      input(),
      { width: 64, height: 64 },
      "legacy",
    )!;
    const awaitedSource = await image();
    let posts = 0,
      receipts = 0;
    const fetcher = (async (_url: any, init: any) => {
      if (init.method === "POST") {
        posts++;
        return response({ process_id: "accepted" });
      }
      throw Error("network interrupted");
    }) as typeof fetch;
    await assert.rejects(
      () =>
        processRemote(
          f.registry.engines.topaz,
          route,
          awaitedSource,
          new AbortController().signal,
          async () => {
            receipts++;
          },
          fetcher,
          async () => {},
        ),
      (e: any) => e instanceof ProviderFailure && e.uncertain && !e.safe,
    );
    assert.equal(posts, 1);
    assert.equal(receipts, 1);
  } finally {
    f.cleanup();
  }
});
// Real Sharp encoding is used below, not a fake output validator.
test("worker reuses private storage, records provider costs and usage in the existing ledger and never regenerates during storage recovery", async () => {
  const f = fixture();
  try {
    const c = loadProcessingConfig({
        ...common,
        AI_OPENAI_ENABLED: "0",
      }).config!,
      source = await image(),
      route = chooseRoute(
        f.registry,
        input(),
        { width: 64, height: 64 },
        "legacy",
      )!;
    const owner = "44444444-4444-4444-8444-444444444444",
      id = "55555555-5555-4555-8555-555555555555";
    let claimed = false,
      calls = 0,
      writes = 0;
    const actions: any[] = [];
    let stored: Buffer | undefined;
    const job = {
      id,
      user_id: owner,
      project_id: base.project_id,
      input_image_id: base.input_image_id,
      submission_key: base.submission_key,
      mode: "personal",
      instructions: "",
      quality: "medium",
      settings: {
        background: "preserve",
        framing: "match",
        preserve_appearance: true,
        processing: input().processing,
        engine_route: route,
      },
      model: "topaz:" + route.model,
      output_size: route.size,
      result_image_id: "66666666-6666-4666-8666-666666666666",
      output_image_id: null,
      status: "running",
      price_snapshot: route.rate,
      provider_started_at: null,
    } as WorkerJob;
    const store: JobStore = {
      async claim() {
        if (claimed) return null;
        claimed = true;
        return job;
      },
      async image() {
        return {
          id: base.input_image_id,
          user_id: owner,
          project_id: base.project_id,
          role: "original",
          status: "ready",
          object_key: "source",
          checksum: hash(source),
          width: 64,
          height: 64,
          byte_size: source.length,
        };
      },
      async step(_id, _worker, action, data) {
        actions.push({ action, data });
        return true;
      },
      async read(key) {
        if (key === "source") return source;
        if (!stored) throw Error("missing");
        return stored;
      },
      async write(_key, bytes) {
        writes++;
        if (writes === 1) throw Error("temporary storage error");
        stored = bytes;
      },
    };
    const worker = new ProcessingWorker(
      store,
      c,
      async (_c, _i, _s, _z, _j, _signal, _owner, receipt) => {
        calls++;
        await receipt?.("remote-id", {
          provider: "topaz",
          operation: "enhance",
          model: route.model,
          output_pixels: 4096,
          elapsed_ms: 0,
          cost_basis: "configured_provider_rate_estimate",
          actual_cost_micro_usd: null,
          price_version: rate.version,
        });
        return {
          encoded: (
            await sharp(source).webp({ lossless: true }).toBuffer()
          ).toString("base64"),
          usage: null,
          requestId: "remote-id",
          estimatedCost: 100,
          engineUsage: {
            provider: "topaz",
            operation: "enhance",
            model: route.model,
            output_pixels: 4096,
            elapsed_ms: 1,
            cost_basis: "configured_provider_rate_estimate",
            actual_cost_micro_usd: null,
            price_version: rate.version,
          },
        };
      },
    );
    await worker.once();
    assert.equal(calls, 1);
    assert.equal(writes, 2);
    assert.equal(actions.at(-1).action, "complete");
    const responses = actions.filter((a) => a.action === "response");
    assert.equal(responses[0].data.cost, null);
    assert.equal(responses.at(-1).data.cost, 100);
    assert.equal(responses.at(-1).data.usage.provider, "topaz");
  } finally {
    f.cleanup();
  }
});

test("Topaz sharpening and denoising are separate native-resolution requests, not a chain or generative restoration", async () => {
  const f = fixture();
  try {
    for (const operation of ["sharpen", "denoise"]) {
      const original = await image();
      const route = chooseRoute(
        f.registry,
        input("topaz", operation),
        { width: 64, height: 64 },
        "legacy",
      )!;
      let posts = 0;
      const fetcher = (async (url: any, init: any) => {
        const target = String(url);
        if (init.method === "POST") {
          posts++;
          assert.ok(target.endsWith(`/${operation}/async`));
          assert.equal(
            init.body.get("model"),
            operation === "sharpen" ? "Natural" : "Normal",
          );
          assert.equal(init.body.get("outputWidth"), null);
          if (operation === "denoise")
            assert.equal(init.body.get("sharpenStrength"), "0");
          return response({ process_id: "test-native-operation" });
        }
        if (target.includes("/status/"))
          return response({ status: "Completed" });
        if (target.includes("/download/"))
          return response({
            download_url: "https://downloads.example.test/results/native.png",
          });
        return new Response(new Uint8Array(original));
      }) as typeof fetch;
      const result = await processRemote(
        f.registry.engines.topaz,
        route,
        original,
        new AbortController().signal,
        undefined,
        fetcher,
        async () => {},
      );
      assert.equal(posts, 1);
      assert.equal(
        result.engineUsage.model,
        operation === "sharpen" ? "Natural" : "Normal",
      );
    }
  } finally {
    f.cleanup();
  }
});

test("provider usage refines the legacy cost-basis label without changing reservation or replaying a request", async () => {
  const writes: any[] = [];
  let calls = 0;
  const builder: any = {
    update(value: any) {
      writes.push(value);
      return builder;
    },
    eq(key: string, value: string) {
      writes.push([key, value]);
      return builder;
    },
    then(resolve: any) {
      resolve({ error: null });
    },
  };
  const admin: any = {
    async rpc() {
      calls++;
      return { data: true, error: null };
    },
    from(table: string) {
      assert.equal(table, "usage_events");
      return builder;
    },
  };
  const store = supabaseJobStore(admin);
  assert.equal(
    await store.step("job", "worker", "response", {
      usage: { provider: "topaz" },
      cost: 123,
    }),
    true,
  );
  assert.equal(calls, 1);
  assert.deepEqual(writes[0], {
    cost_basis: "configured_provider_rate_estimate",
  });
  assert.deepEqual(writes[2], ["idempotency_key", "processing:job"]);
});

test("a separately verified provider remains configured when OpenAI credentials or pricing are absent", () => {
  const f = fixture();
  try {
    const loaded = loadProcessingConfig({ ...common, ...f.env });
    assert.ok(loaded.config);
    assert.equal(loaded.config.AI_OPENAI_API_KEY, "");
    assert.equal(loaded.config.AI_PRICE_VERSION, "not_applicable");
  } finally {
    f.cleanup();
  }
});
test("dedicated quotes reserve existing allowance units using their own immutable rates, without OpenAI token estimates", async () => {
  const f = fixture();
  try {
    const config = loadProcessingConfig({
      ...common,
      AI_OPENAI_ENABLED: "0",
    }).config;
    const account = {
      plan: "pro",
      account: { balance_credits: 100, reserved_credits: 0 },
    };
    const engine: any = {
      billing: { account: async () => account },
      config,
      packConfig: null,
      engines: f.registry,
    };
    const plan = await meterPlan(
      engine,
      input(),
      { width: 64, height: 64 },
      {} as any,
    );
    assert.equal(plan!.plan.unit_micro_usd, 10000);
    assert.equal(plan!.plan.generation_credits, 1);
    assert.equal(plan!.reserved_micro_usd, 200);
    assert.equal(plan!.quality_reserved_micro_usd, 0);
    assert.equal(plan!.vision, null);
    account.plan = "free";
    await assert.rejects(
      () => meterPlan(engine, input(), { width: 64, height: 64 }, {} as any),
      /billing_entitlement/,
    );
  } finally {
    f.cleanup();
  }
});

test("customer history exposes engine context while keeping route rates and reservation details server-side", async () => {
  const { default: express } = await import("express");
  const { default: request } = await import("supertest");
  const { processingRoutes } = await import(
    "../../server/processing/routes.js"
  );
  const app = express();
  const row = {
    id: base.submission_key,
    mode: "personal",
    settings: {
      background: "preserve",
      engine_route: {
        version: ADAPTER_VERSION,
        provider: "topaz",
        model: "Natural",
        experience: "authentic",
        operation: "sharpen",
        size: "64x64",
        rate: { micro_usd: 123, reserve_multiplier: 2 },
        route_hash: "private-route-digest",
        estimate_micro_usd: 123,
        reserve_micro_usd: 246,
      },
    },
  };
  const query: any = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    async maybeSingle() {
      return { data: row, error: null };
    },
  };
  processingRoutes(
    app,
    { qualityReady: async () => false, packsReady: async () => false } as any,
    () => ({ client: { from: () => query } }) as any,
  );
  const response = await request(app).get("/api/jobs/" + base.submission_key);
  assert.equal(response.status, 200);
  assert.equal(response.body.job.settings.engine_route.provider, "topaz");
  assert.equal(response.body.job.settings.engine_route.rate, undefined);
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /private-route-digest|reserve_multiplier|reserve_micro_usd/,
  );
});

test("admission pins the native dedicated route in the existing job without adding creative product operations or OpenAI assessment", async () => {
  const f = fixture();
  try {
    let payload: any;
    const admin: any = {
      async rpc(name: string, args: any) {
        if (name === "processing_schema_version")
          return { data: 2026102801, error: null };
        if (name === "product_quality_schema_version")
          return { data: 2026102802, error: null };
        if (name === "submit_processing_job") {
          payload = args.p;
          return {
            data: { id: base.submission_key, status: "queued" },
            error: null,
          };
        }
        throw Error("Unexpected call " + name);
      },
    };
    const engine = new ProcessingEngine(admin, { ...common, ...f.env });
    assert.equal(engine.engines.openaiEnabled, false);
    engine.worker!.start = () => {};
    engine.worker!.wake = () => {};
    engine.qualityWorker.start = () => {};
    const capabilities = await engine.capabilities();
    assert.equal(capabilities.authentic_enabled, true);
    assert.equal(capabilities.creative_enabled, false);
    assert.equal(capabilities.model, null);
    assert.equal(capabilities.vision_assessment, false);
    const query: any = {
      select() {
        return query;
      },
      eq() {
        return query;
      },
      async maybeSingle() {
        return {
          data: {
            id: base.input_image_id,
            width: 64,
            height: 64,
            role: "original",
            status: "ready",
          },
          error: null,
        };
      },
    };
    await engine.submit(jobInput.parse({ ...input(), mode: "product" }), {
      userId: "44444444-4444-4444-8444-444444444444",
      client: { from: () => query },
    } as any);
    assert.equal(payload.model, "topaz:Upscale High Fidelity V3");
    assert.equal(payload.output_size, "64x64");
    assert.equal(payload.settings.engine_route.provider, "topaz");
    assert.equal(payload.settings.product_options, undefined);
    assert.equal(payload.quality_model, null);
    assert.equal(payload.quality_retry_limit, 0);
    assert.equal(payload.reserved_micro_usd, 1e6);
    assert.equal(
      payload.price_snapshot.basis,
      "configured_provider_rate_estimate",
    );
    assert.equal(payload.prompt_version, "multi-engine-v1:enhance");
  } finally {
    f.cleanup();
  }
});
