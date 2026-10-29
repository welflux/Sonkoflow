import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import {
  brandSettings,
  brandPatch,
  brandSelection,
  brandDirection,
  profileInput,
  presetInput,
  type BrandSnapshot,
} from "../../server/brand/contracts.js";
import { BrandService } from "../../server/brand/service.js";
import {
  validateAsset,
  compositeBrand,
  footerLayout,
} from "../../server/brand/assets.js";
import { assessBrandLayout } from "../../server/brand/assessment.js";
import {
  jobInput,
  buildPrompt,
  fingerprint,
} from "../../server/processing/contracts.js";
import {
  ProcessingEngine,
  ProcessingWorker,
  type JobStore,
  type WorkerJob,
} from "../../server/processing/engine.js";
import {
  loadProcessingConfig,
  priceSnapshot,
} from "../../server/processing/config.js";
import { packInput } from "../../server/packs/contracts.js";
import { makePackPlan } from "../../server/packs/plan.js";
import { loadPackConfig } from "../../server/packs/config.js";
import { hash } from "../../server/security.js";
const owner = randomUUID(),
  profileId = randomUUID(),
  presetId = randomUUID(),
  assetId = randomUUID(),
  project = randomUUID(),
  sourceId = randomUUID(),
  jobId = randomUUID();
const selection = {
  profile_id: profileId,
  profile_revision: 1,
  preset_id: presetId,
  preset_revision: 2,
  overrides: { spacing: "generous" as const },
};
const profile = {
  id: profileId,
  user_id: owner,
  name: "Evergreen",
  revision: 1,
  deleted: false,
  settings: brandSettings.parse({
    theme: "cool",
    spacing: "tight",
    canvas: "portrait",
  }),
};
const preset = {
  id: presetId,
  user_id: owner,
  profile_id: profileId,
  name: "Warm listing",
  purpose: "listing",
  revision: 2,
  deleted: false,
  settings: { theme: "warm", spacing: "balanced" },
};
const env = {
  AI_PROCESSING_ENABLED: "1",
  AI_OPENAI_API_KEY: "test-key",
  AI_OPERATION_RESERVE_USD: ".1",
  AI_USER_DAILY_BUDGET_USD: "10",
  AI_GLOBAL_DAILY_BUDGET_USD: "20",
  AI_PRICE_VERSION: "test-only",
  AI_TEXT_INPUT_USD_PER_MILLION: "5",
  AI_IMAGE_INPUT_USD_PER_MILLION: "8",
  AI_IMAGE_OUTPUT_USD_PER_MILLION: "30",
};
const config = loadProcessingConfig(env).config!;
const pc = loadPackConfig({
  AI_PACKS_ENABLED: "1",
  AI_PACK_CREDIT_MICRO_USD: "1000",
  AI_PACK_TOKEN_ESTIMATES_JSON: JSON.stringify({
    model: config.AI_IMAGE_MODEL,
    version: "test-estimates-only",
    max_source_pixels: 25000000,
    input_image_tokens: 1000,
    output_image_tokens: Object.fromEntries(
      ["low", "medium", "high"].map((q) => [
        q,
        { square: 1000, landscape: 2000 },
      ]),
    ),
  }),
})!;
function mockClient(rows: Record<string, any[]>, user = owner) {
  return {
    from(table: string) {
      let result = (rows[table] ?? []).filter(
        (r) => !r.user_id || r.user_id === user,
      );
      let single = false;
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          result = result.filter((r) => r[k] === v);
          return q;
        },
        in: (k: string, v: any[]) => {
          result = result.filter((r) => v.includes(r[k]));
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          result = result.slice(0, n);
          return q;
        },
        contains: (_k: string, v: any) => {
          result = result.filter(
            (r) =>
              r.settings?.brand_snapshot?.logo?.id === v.brand_snapshot.logo.id,
          );
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        single: () => {
          single = true;
          return q;
        },
        then: (resolve: any) =>
          resolve({
            data: single
              ? (structuredClone(result[0]) ?? null)
              : structuredClone(result),
            error: null,
          }),
      };
      return q;
    },
  } as any;
}
function fixture() {
  const rows = {
    brand_profiles: [structuredClone(profile)],
    brand_presets: [structuredClone(preset)],
    brand_assets: [] as any[],
    processing_jobs: [] as any[],
    images: [
      {
        id: sourceId,
        user_id: owner,
        project_id: project,
        width: 1024,
        height: 1024,
        role: "original",
        status: "ready",
      },
    ],
  };
  const client = mockClient(rows);
  const admin: any = {
    ...client,
    rpc: async (name: string, args: any) =>
      name === "brand_schema_version"
        ? { data: 2026102804, error: null }
        : { data: { id: jobId, status: "queued", ...args?.p }, error: null },
  };
  return {
    rows,
    admin,
    identity: { userId: owner, client } as any,
    service: new BrandService(admin),
  };
}
function snapshot(settings: any = {}): BrandSnapshot {
  return {
    version: "brand-v1",
    profile_id: profileId,
    profile_name: profile.name,
    profile_revision: 1,
    preset_id: null,
    preset_name: null,
    preset_revision: null,
    settings: brandSettings.parse(settings),
    logo: null,
    precedence: "Profile → preset → job",
  };
}
test("Structured brand controls reject unsupported formats, unsafe fields and non-product application", () => {
  assert.deepEqual(brandPatch.parse({}), {});
  assert.throws(() =>
    profileInput.parse({ name: "Brand", settings: { primary_color: "red" } }),
  );
  assert.throws(() =>
    presetInput.parse({ name: "Preset", purpose: "checkout", settings: {} }),
  );
  assert.throws(() =>
    brandSelection.parse({ ...selection, overrides: { model: "override" } }),
  );
  assert.throws(() => brandSettings.parse({ instructions: "\x00" }));
  const i = {
    project_id: project,
    input_image_id: sourceId,
    submission_key: jobId,
    mode: "portrait",
    preserve_appearance: true,
    provider_consent: true,
    brand: selection,
  };
  assert.throws(() => jobInput.parse(i));
  assert.throws(() => jobInput.parse({ ...i, mode: "personal" }));
  assert(jobInput.parse({ ...i, mode: "product" }).brand);
});
test("Saved profile → preset → explicit override resolves on the server and historical snapshots remain detached", async () => {
  const f = fixture(),
    saved = (await f.service.resolve(selection, f.identity))!;
  assert.equal(saved.settings.theme, "warm");
  assert.equal(saved.settings.spacing, "generous");
  assert.equal(saved.settings.canvas, "portrait");
  assert.equal(saved.preset_revision, 2);
  f.rows.brand_profiles[0].settings.primary_color = "#FF0000";
  f.rows.brand_profiles[0].name = "Renamed";
  assert.equal(saved.settings.primary_color, "#142F3E");
  assert.equal(saved.profile_name, "Evergreen");
  f.rows.brand_profiles[0].revision = 2;
  await assert.rejects(
    f.service.resolve(selection, f.identity),
    (e) => (e as any).code === "brand_conflict",
  );
});
test("Cross-account, deleted profile, mismatched preset and unowned logo are rejected before generation", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.resolve(selection, {
      ...f.identity,
      client: mockClient(f.rows, randomUUID()),
    }),
    (e) => (e as any).status === 404,
  );
  await assert.rejects(
    f.service.resolve({ ...selection, preset_id: randomUUID() }, f.identity),
    (e) => (e as any).status === 404,
  );
  await assert.rejects(
    f.service.resolve(
      {
        ...selection,
        overrides: { logo_asset_id: assetId, logo_placement: "footer" },
      },
      f.identity,
    ),
    (e) => (e as any).status === 404,
  );
  f.rows.brand_profiles[0].deleted = true;
  await assert.rejects(
    f.service.resolve(selection, f.identity),
    (e) => (e as any).status === 404,
  );
});
test("Asset decoder preserves transparency and rejects SVG, forged MIME, animation, oversized and unreadable content", async () => {
  const png = await sharp({
    create: {
      width: 80,
      height: 60,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const a = await validateAsset(png, "image/png");
  assert.equal(a.width, 80);
  assert.equal(a.height, 60);
  assert((await sharp(a.bytes).metadata()).hasAlpha);
  for (const [bytes, mime] of [
    [Buffer.from("<svg/>"), "image/svg+xml"],
    [png, "image/jpeg"],
    [Buffer.alloc(2 * 1024 * 1024 + 1), "image/png"],
    [Buffer.from("broken"), "image/png"],
  ] as const)
    await assert.rejects(validateAsset(bytes, mime));
  const tiny = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  await assert.rejects(validateAsset(tiny, "image/png"));
});
test("Uploaded logo is composited directly in a reserved strip without stretching/cropping the photograph; returned pixels and quality findings are checked", async () => {
  const png = await sharp({
      create: { width: 40, height: 24, channels: 4, background: "#FF0000" },
    })
      .png()
      .toBuffer(),
    a = await validateAsset(png, "image/png");
  const brand = snapshot({
    logo_asset_id: assetId,
    logo_placement: "footer",
    logo_align: "right",
  });
  brand.logo = {
    id: assetId,
    checksum: a.checksum,
    width: a.width,
    height: a.height,
  };
  const output = await sharp({
      create: { width: 1024, height: 1536, channels: 3, background: "#0000FF" },
    })
      .webp()
      .toBuffer(),
    result = await compositeBrand(output, a.bytes, brand),
    m = await sharp(result).metadata();
  assert.equal(m.width, 1024);
  assert.equal(m.height, 1536);
  const { band, pad, top } = footerLayout(1024, 1536, brand.settings);
  assert.equal(top + band, 1536);
  const logoPixels = await sharp(a.bytes).ensureAlpha().raw().toBuffer();
  const recovered = await sharp(result)
    .extract({
      left: 1024 - pad - 40,
      top: top + Math.floor((band - 24) / 2),
      width: 40,
      height: 24,
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual(recovered, logoPixels);
  const assessment = await assessBrandLayout(result, brand);
  assert.equal(
    assessment.find((c) => c.id === "brand_layout")?.status,
    "passed",
  );
  assert.equal(
    assessment.find((c) => c.id === "brand_adherence")?.status,
    "needs_review",
  );
  await assert.rejects(compositeBrand(output, Buffer.from("changed"), brand));
});
test("Brand pack plans preserve explicit output canvases, fidelity constraints, cost accounting and retry snapshots", () => {
  const b = snapshot({
      canvas: "portrait",
      background_color: "#AABBCC",
      theme: "warm",
    }),
    i = packInput.parse({
      project_id: project,
      input_image_id: sourceId,
      outputs: [
        { type: "listing", quality: "low" },
        { type: "wide", quality: "high" },
      ],
      brand: selection,
    });
  const p = makePackPlan(
    i,
    { width: 1024, height: 1024, checksum: "test" },
    config,
    null,
    pc,
    2,
    b,
  );
  assert.equal(
    p.outputs[0].job.settings.brand_snapshot?.settings.canvas,
    "square",
  );
  assert.equal(
    p.outputs[1].job.settings.brand_snapshot?.settings.canvas,
    "landscape",
  );
  assert.equal(b.settings.canvas, "portrait");
  assert(p.reserved_credits > 0);
  assert(p.outputs[1].estimated_credits > p.outputs[0].estimated_credits);
  const prompt = buildPrompt({
    ...jobInput.parse({
      project_id: project,
      input_image_id: sourceId,
      submission_key: jobId,
      mode: "product",
      preserve_appearance: true,
      provider_consent: true,
    }),
    brand_snapshot: b,
  });
  assert.match(prompt, /never recolor the real product/);
  assert.match(prompt, /#AABBCC/);
  assert.match(prompt, /Prioritize|Preserve|preserv/);
  assert.match(brandDirection(b), /Exact colors/);
  const changed = makePackPlan(
    i,
    { width: 1024, height: 1024, checksum: "test" },
    config,
    null,
    pc,
    2,
    { ...b, profile_revision: 2 },
  );
  assert.notEqual(changed.fingerprint, p.fingerprint);
});
test("Existing processing engine submits the resolved immutable brand snapshot and explicit job canvas/background win", async () => {
  const f = fixture(),
    engine = new ProcessingEngine(f.admin, env);
  engine.schemaReady = async () => true;
  engine.qualityReady = async () => true;
  engine.qualityWorker.start = () => {};
  engine.worker!.start = () => {};
  engine.worker!.wake = () => {};
  const input = jobInput.parse({
    project_id: project,
    input_image_id: sourceId,
    submission_key: jobId,
    mode: "product",
    framing: "landscape",
    background: "preserve",
    preserve_appearance: true,
    provider_consent: true,
    brand: selection,
  });
  const job = await engine.submit(input, f.identity);
  assert.equal(job.settings.brand_snapshot?.settings.theme, "warm");
  assert.equal(job.settings.brand_snapshot?.settings.canvas, "landscape");
  assert.equal(
    job.settings.brand_snapshot?.settings.background_style,
    "preserve",
  );
  assert.equal(job.output_size, "1536x1024");
  assert.equal((job as any).prompt_version, "brand-product-v1");
  await engine.stop();
});
test("Worker records real provider usage, verifies the saved asset before dispatch and persists the composited output once", async () => {
  const logo = await validateAsset(
    await sharp({
      create: { width: 80, height: 30, channels: 4, background: "#F00" },
    })
      .png()
      .toBuffer(),
    "image/png",
  );
  const brand = snapshot({ logo_asset_id: assetId, logo_placement: "footer" });
  brand.logo = { id: assetId, checksum: logo.checksum, width: 80, height: 30 };
  const source = await sharp({
      create: { width: 128, height: 128, channels: 3, background: "#eee" },
    })
      .webp()
      .toBuffer(),
    generated = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#88A" },
    })
      .webp()
      .toBuffer();
  const job = {
    id: jobId,
    user_id: owner,
    project_id: project,
    input_image_id: sourceId,
    submission_key: jobId,
    mode: "product",
    instructions: "",
    quality: "low",
    settings: {
      background: "clean",
      framing: "square",
      preserve_appearance: true,
      brand_snapshot: brand,
    },
    model: config.AI_IMAGE_MODEL,
    output_size: "1024x1024",
    result_image_id: randomUUID(),
    output_image_id: null,
    status: "running",
    price_snapshot: priceSnapshot(config),
    provider_started_at: null,
  } as WorkerJob;
  const events: any[] = [],
    objects = new Map([
      ["source", source],
      ["logo", logo.bytes],
    ]);
  let calls = 0;
  const store: JobStore = {
    claim: async () => job,
    step: async (_id, _worker, action, p) => {
      events.push({ action, p });
      return true;
    },
    image: async () => ({
      id: sourceId,
      user_id: owner,
      project_id: project,
      role: "original",
      status: "ready",
      object_key: "source",
      checksum: hash(source),
      width: 128,
      height: 128,
      byte_size: source.length,
    }),
    read: async (key) => objects.get(key)!,
    write: async (key, b) => {
      objects.set(key, b);
    },
    brandAsset: async () => ({ object_key: "logo", checksum: logo.checksum }),
  };
  const provider: any = async (_c: any, input: any) => {
    calls++;
    assert.equal(input.brand_snapshot.profile_name, "Evergreen");
    return {
      encoded: generated.toString("base64"),
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        total_tokens: 300,
        input_tokens_details: { text_tokens: 10, image_tokens: 90 },
      },
      requestId: "test-request",
    };
  };
  await new ProcessingWorker(store, config, provider).once();
  assert.equal(calls, 1);
  assert.deepEqual(
    events.map((e) => e.action),
    ["dispatch", "response", "prepare", "complete"],
  );
  assert(events[1].p.usage);
  const bytes = objects.get(`${owner}/${job.result_image_id}.webp`)!;
  assert(bytes && !bytes.equals(generated));
  assert.equal(events[2].p.checksum, hash(bytes));
  events.length = 0;
  objects.set("logo", Buffer.from("corrupt"));
  await new ProcessingWorker(store, config, provider).once();
  assert.equal(calls, 1);
  assert.equal(events[0].action, "fail");
  assert.equal(
    events[0].p.error_code ?? events[0].p.code,
    "brand_asset_unavailable",
  );
  events.length = 0;
  // A deliberately corrupt test fixture exercises a local failure after metering.
  brand.logo!.checksum = hash(Buffer.from("corrupt"));
  store.brandAsset = async () => ({
    object_key: "logo",
    checksum: brand.logo!.checksum,
  });
  job.result_image_id = randomUUID();
  await new ProcessingWorker(store, config, provider).once();
  assert.equal(calls, 2);
  assert.deepEqual(
    events.map((e) => e.action),
    ["dispatch", "response", "fail"],
  );
  assert.equal(events[2].p.code, "brand_composite_failed");
  assert.equal(events[2].p.safe, false);
  assert.equal(objects.has(`${owner}/${job.result_image_id}.webp`), false);
});

test("Lost branded submission acknowledgement reuses the stored job even after the profile changes", async () => {
  const f = fixture(),
    engine = new ProcessingEngine(f.admin, env);
  engine.schemaReady = async () => true;
  engine.qualityReady = async () => true;
  const input = jobInput.parse({
    project_id: project,
    input_image_id: sourceId,
    submission_key: jobId,
    mode: "product",
    framing: "square",
    background: "clean",
    preserve_appearance: true,
    provider_consent: true,
    brand: selection,
  });
  f.rows.processing_jobs.push({
    id: jobId,
    user_id: owner,
    submission_key: jobId,
    status: "queued",
    request_fingerprint: fingerprint(input),
    settings: { brand_snapshot: snapshot() },
  });
  f.rows.brand_profiles[0].revision = 99;
  f.rows.brand_profiles[0].deleted = true;
  const found = await engine.submit(input, f.identity);
  assert.equal(found.id, jobId);
  assert.equal(found.settings.brand_snapshot.profile_revision, 1);
  await assert.rejects(
    engine.submit(
      { ...input, instructions: "A different request" },
      f.identity,
    ),
    (e) => (e as any).code === "submission_conflict",
  );
  await engine.stop();
});
