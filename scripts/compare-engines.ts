// Explicitly billable operator tool. This script is never invoked by app startup.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import {
  loadEngineRegistry,
  ADAPTER_VERSION,
  routeDigest,
  topazModel,
  type EngineRoute,
} from "../server/processing/engine-registry.js";
import {
  loadProcessingConfig,
  priceSnapshot,
} from "../server/processing/config.js";
import {
  editImage,
  estimateCost,
  validateOutput,
  ProviderFailure,
} from "../server/processing/provider.js";
import { processRemote } from "../server/processing/remote-providers.js";
import { jobInput, outputSize } from "../server/processing/contracts.js";
import { hash } from "../server/security.js";
const manifestSchema = z
  .object({
    permission_confirmed: z.literal(true),
    max_total_reservation_micro_usd: z.number().int().positive(),
    operation: z.enum([
      "enhance",
      "upscale",
      "sharpen",
      "denoise",
      "product_finish",
    ]),
    scale: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    samples: z
      .array(
        z
          .object({
            category: z.enum(["portrait", "product", "commercial"]),
            file: z.string().min(1),
          })
          .strict(),
      )
      .length(3),
  })
  .strict();
async function main() {
  if (process.env.RUN_LIVE_ENGINE_COMPARISON !== "1")
    throw Error(
      "Disabled: explicitly arm the comparison only after approving a total API reservation budget.",
    );
  const file = process.argv[2];
  if (!file)
    throw Error("Provide a local, permission-confirmed comparison manifest.");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(file, "utf8")),
  );
  if (new Set(manifest.samples.map((s) => s.category)).size !== 3)
    throw Error(
      "Provide exactly one portrait, one product photograph and one commercial photograph.",
    );
  const c = loadProcessingConfig({
    ...process.env,
    AI_PROCESSING_ENABLED: "1",
    AI_OPENAI_ENABLED: "1",
  }).config;
  if (!c)
    throw Error(
      "Reviewed OpenAI pricing, credentials and common budget configuration are required.",
    );
  const registry = loadEngineRegistry({
    ...process.env,
    AI_MULTI_ENGINE_ENABLED: "1",
    AI_TOPAZ_ENABLED: "1",
    AI_CLAID_ENABLED: "1",
  });
  for (const e of Object.values(registry.engines))
    if (![null, "live_validation_required"].includes(e.reason))
      throw Error(`${e.id}: ${e.reason}`);
  if (
    manifest.operation === "upscale"
      ? ![2, 4].includes(manifest.scale)
      : manifest.scale !== 1
  )
    throw Error(
      "Use 2x/4x for upscale and original resolution for other operations.",
    );
  const cases = [];
  for (const sample of manifest.samples) {
    const raw = await readFile(path.resolve(path.dirname(file), sample.file));
    if (raw.length > 10 * 1024 * 1024) throw Error("A source exceeds 10 MB.");
    const pipeline = sharp(raw, {
        limitInputPixels: 25_000_000,
        animated: false,
        failOn: "warning",
      }),
      meta = await pipeline.metadata();
    if (
      (meta.pages ?? 1) > 1 ||
      !["png", "jpeg", "webp"].includes(meta.format || "")
    )
      throw Error("Only static PNG, JPEG and WebP photographs are supported.");
    const source = await pipeline.rotate().webp({ lossless: true }).toBuffer(),
      dims = await sharp(source).metadata();
    cases.push({
      ...sample,
      source,
      original_sha256: hash(raw),
      source_sha256: hash(source),
      width: dims.width!,
      height: dims.height!,
    });
  }
  if (new Set(cases.map((s) => s.source_sha256)).size !== 3)
    throw Error("Use three distinct original photographs.");
  const planned = cases.flatMap((s) =>
    Object.values(registry.engines).map((e) => {
      const pixels = s.width * s.height * manifest.scale ** 2,
        rate = e.rate!;
      if (pixels > rate.max_output_pixels)
        throw Error("A reference exceeds reviewed output dimensions.");
      return Math.ceil(
        Math.max(
          rate.minimum_micro_usd,
          rate.micro_usd * (rate.unit === "operation" ? 1 : pixels / 1e6),
        ) * rate.reserve_multiplier,
      );
    }),
  );
  const reserve =
    planned.reduce((a, b) => a + b, 0) +
    cases.length * Math.ceil(c.AI_OPERATION_RESERVE_USD * 1e6);
  if (reserve > manifest.max_total_reservation_micro_usd)
    throw Error(
      "Planned reservations exceed the explicit comparison budget. No requests made.",
    );
  const destination = path.resolve("artifacts/engine-comparison", randomUUID());
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const reports: any = {};
  for (const provider of ["openai", "topaz", "claid"] as const)
    reports[provider] = {
      version: ADAPTER_VERSION,
      provider,
      model:
        provider === "openai"
          ? c.AI_IMAGE_MODEL
          : registry.engines[provider].model,
      price_version:
        provider === "openai"
          ? c.AI_PRICE_VERSION
          : registry.engines[provider].rate!.version,
      approved: false,
      samples: [],
    };
  console.log(
    `Reserved comparison budget: ${reserve} micro USD. This is an admission estimate, not a provider invoice ceiling. Output: ${destination}`,
  );
  for (const sample of cases)
    for (const provider of ["openai", "topaz", "claid"] as const) {
      const started = Date.now(),
        id = randomUUID();
      let receipt: string | null = null;
      const record: any = {
        category: sample.category,
        model:
          provider === "openai"
            ? c.AI_IMAGE_MODEL
            : provider === "topaz"
              ? topazModel(manifest.operation)
              : registry.engines.claid.model,
        operation: manifest.operation,
        scale: manifest.scale,
        original_sha256: sample.original_sha256,
        source_sha256: sample.source_sha256,
        identity_review: "pending",
        detail_review: "pending",
        naturalness_review: "pending",
        actual_cost_micro_usd: null,
        invoice_reference: null,
        live_request_id: null,
      };
      try {
        const input = jobInput.parse({
          project_id: id,
          input_image_id: randomUUID(),
          submission_key: randomUUID(),
          mode: sample.category === "portrait" ? "portrait" : "product",
          quality: "medium",
          framing: "match",
          background: "preserve",
          preserve_appearance: true,
          provider_consent: true,
        });
        let result, size: string, cost: number | null;
        if (provider === "openai") {
          size = outputSize(input, sample.width, sample.height);
          result = await editImage(
            c,
            input,
            sample.source,
            size,
            id,
            AbortSignal.timeout(c.AI_TIMEOUT_SECONDS * 1000),
          );
          cost = estimateCost(result.usage, priceSnapshot(c));
        } else {
          const engine = registry.engines[provider],
            rate = engine.rate!,
            pixels = sample.width * sample.height * manifest.scale ** 2;
          const estimate = Math.ceil(
            Math.max(
              rate.minimum_micro_usd,
              rate.micro_usd * (rate.unit === "operation" ? 1 : pixels / 1e6),
            ),
          );
          size = `${sample.width * manifest.scale}x${sample.height * manifest.scale}`;
          const base = {
            version: ADAPTER_VERSION,
            provider,
            model:
              provider === "topaz"
                ? topazModel(manifest.operation)
                : engine.model,
            experience:
              manifest.operation === "product_finish"
                ? "creative"
                : "authentic",
            operation: manifest.operation,
            size,
            rate,
            estimate_micro_usd: estimate,
            reserve_micro_usd: Math.ceil(estimate * rate.reserve_multiplier),
          } as EngineRoute;
          base.route_hash = routeDigest(base);
          if (provider === "topaz" && manifest.operation === "product_finish")
            throw Error("Topaz is not a creative background engine.");
          if (
            provider === "claid" &&
            !["upscale", "product_finish"].includes(manifest.operation)
          )
            throw Error("Use upscale for the Claid authentic comparison.");
          result = await processRemote(
            engine,
            base,
            sample.source,
            AbortSignal.timeout(c.AI_TIMEOUT_SECONDS * 1000),
            async (accepted) => {
              receipt = accepted;
              record.live_request_id = accepted;
              await writeFile(
                path.join(destination, provider + ".json"),
                JSON.stringify(
                  {
                    ...reports[provider],
                    samples: [
                      ...reports[provider].samples,
                      { ...record, status: "accepted" },
                    ],
                  },
                  null,
                  2,
                ),
                { mode: 0o600 },
              );
            },
          );
          cost = result.estimatedCost;
        }
        const output = await validateOutput(result.encoded, size);
        await writeFile(
          path.join(destination, `${provider}-${sample.category}.webp`),
          output.bytes,
          { flag: "wx", mode: 0o600 },
        );
        Object.assign(record, {
          status: "completed",
          output_sha256: output.checksum,
          output_width: output.width,
          output_height: output.height,
          output_pixels: output.width * output.height,
          live_request_id: result.requestId ?? receipt,
          configured_estimate_micro_usd: cost,
        });
      } catch (error) {
        record.status = "failed";
        record.error_code =
          error instanceof ProviderFailure ? error.code : "comparison_blocked";
        record.live_request_id = receipt;
      }
      record.elapsed_ms = Date.now() - started;
      reports[provider].samples.push(record);
      await writeFile(
        path.join(destination, provider + ".json"),
        JSON.stringify(reports[provider], null, 2),
        { mode: 0o600 },
      );
    }
  console.log(
    "Comparison finished. Reports are unapproved. Review identity, geometry, labels, texture and naturalness; enter actual invoice costs before approval. Failed calls are never silently retried.",
  );
}
main().catch(() => {
  console.error(
    "Comparison blocked. Check the manifest, private server configuration and explicit spending limit. No credentials or provider response bodies are logged.",
  );
  process.exitCode = 1;
});
