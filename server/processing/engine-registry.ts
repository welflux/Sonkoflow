import { z } from "zod";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { AppError, hash } from "../security.js";
import type { JobInput } from "./contracts.js";
export const ADAPTER_VERSION = "multi-engine-v2";
export const processingSelection = z
  .object({
    experience: z.enum(["authentic", "creative"]),
    engine: z.enum(["auto", "openai", "topaz", "claid"]).default("auto"),
    operation: z
      .enum(["enhance", "upscale", "sharpen", "denoise", "product_finish"])
      .default("enhance"),
    scale: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
    consented_engine: z.enum(["openai", "topaz", "claid"]),
  })
  .strict();
export type Selection = z.infer<typeof processingSelection>;
export type EngineId = "openai" | "topaz" | "claid";
const rateSchema = z
  .object({
    version: z.string().min(5).max(100),
    unit: z.enum(["operation", "output_megapixel"]),
    micro_usd: z.number().int().positive().max(1e9),
    minimum_micro_usd: z.number().int().positive().max(1e9),
    max_output_pixels: z.number().int().min(4096).max(25_000_000),
    reserve_multiplier: z.number().min(2).max(10),
  })
  .strict();
export type EngineRate = z.infer<typeof rateSchema>;
export type RemoteEngine = {
  id: "topaz" | "claid";
  key: string;
  enabled: boolean;
  verified: boolean;
  reason: string | null;
  rate: EngineRate | null;
  outputPrefixes: string[];
  model: string;
  verifiedCases: string[];
};
export type Registry = {
  enabled: boolean;
  openaiEnabled: boolean;
  engines: Record<"topaz" | "claid", RemoteEngine>;
};
export type EngineRoute = {
  version: typeof ADAPTER_VERSION;
  provider: EngineId;
  model: string;
  experience: "authentic" | "creative";
  operation: Selection["operation"];
  size: string;
  rate: EngineRate | null;
  estimate_micro_usd: number;
  reserve_micro_usd: number;
  route_hash: string;
};
export function topazModel(operation: string) {
  return operation === "sharpen"
    ? "Natural"
    : operation === "denoise"
      ? "Normal"
      : "Upscale High Fidelity V3";
}
function publicPrefix(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash &&
      !isIP(u.hostname) &&
      u.hostname.includes(".") &&
      !/(^|\.)(localhost|local|internal)$/.test(u.hostname) &&
      u.pathname.endsWith("/")
    );
  } catch {
    return false;
  }
}
function verified(
  path: string | undefined,
  id: string,
  model: string,
  rate: EngineRate | null,
): string[] {
  if (!path || !rate) return [];
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    if (
      v.version !== ADAPTER_VERSION ||
      v.provider !== id ||
      v.model !== model ||
      v.price_version !== rate.version ||
      v.approved !== true
    )
      return [];
    const valid = (v.samples ?? []).filter(
      (s: any) =>
        ["portrait", "product", "commercial"].includes(s.category) &&
        s.status === "completed" &&
        s.model ===
          (id === "topaz" ? topazModel(s.operation) : "claid-edit-v1") &&
        /^[a-f0-9]{64}$/.test(s.source_sha256) &&
        /^[a-f0-9]{64}$/.test(s.output_sha256) &&
        typeof s.live_request_id === "string" &&
        s.live_request_id.length > 0 &&
        s.identity_review === "passed" &&
        s.detail_review === "passed" &&
        s.naturalness_review === "passed" &&
        Number.isSafeInteger(s.actual_cost_micro_usd) &&
        s.actual_cost_micro_usd > 0 &&
        typeof s.invoice_reference === "string" &&
        s.invoice_reference.trim().length > 0 &&
        s.elapsed_ms > 0 &&
        Number.isSafeInteger(s.output_pixels) &&
        s.output_pixels > 0 &&
        s.output_pixels <= rate.max_output_pixels &&
        s.actual_cost_micro_usd <=
          Math.ceil(
            Math.max(
              rate.minimum_micro_usd,
              rate.micro_usd *
                (rate.unit === "operation" ? 1 : s.output_pixels / 1e6),
            ) * rate.reserve_multiplier,
          ),
    );
    return [
      "enhance:1",
      "upscale:2",
      "upscale:4",
      "sharpen:1",
      "denoise:1",
      "product_finish:1",
    ].filter(
      (key) =>
        ["portrait", "product", "commercial"].every((category) =>
          valid.some(
            (s: any) =>
              s.category === category && `${s.operation}:${s.scale}` === key,
          ),
        ) &&
        new Set(
          valid
            .filter((s: any) => `${s.operation}:${s.scale}` === key)
            .map((s: any) => s.source_sha256),
        ).size >= 3,
    );
  } catch {
    return [];
  }
}
export function routeDigest(
  value: Omit<EngineRoute, "route_hash"> | EngineRoute,
) {
  const { route_hash, ...rest } = value as EngineRoute;
  const sorted = (v: any): any =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted(v[k])]),
          )
        : v;
  return hash(JSON.stringify(sorted(rest)));
}
export function loadEngineRegistry(
  env: NodeJS.ProcessEnv = process.env,
): Registry {
  const engines = {} as Registry["engines"];
  for (const id of ["topaz", "claid"] as const) {
    const prefix = "AI_" + id.toUpperCase();
    let rate: EngineRate | null = null;
    try {
      rate = rateSchema.parse(JSON.parse(env[prefix + "_PRICE_JSON"] || ""));
    } catch {}
    const model = id === "topaz" ? "Upscale High Fidelity V3" : "claid-edit-v1";
    const outputPrefixes =
      id === "claid"
        ? [
            "https://storage.googleapis.com/production-leapi-tmp-public/",
            // Observed in an authenticated live Claid response, 31 Oct 2026.
            // Exact first-party origin only; downloads still reject redirects.
            "https://dl.claid.ai/",
          ]
        : (env.AI_TOPAZ_OUTPUT_PREFIXES || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    const validOutput =
      outputPrefixes.length > 0 && outputPrefixes.every(publicPrefix);
    const cases = verified(env[prefix + "_VERIFICATION_FILE"], id, model, rate);
    const live = cases.length > 0;
    const key = env[prefix + "_API_KEY"] || "";
    const reason =
      env.AI_MULTI_ENGINE_ENABLED !== "1" || env[prefix + "_ENABLED"] !== "1"
        ? "disabled"
        : !key || key.length > 4096 || /[\r\n\0]/.test(key)
          ? "credentials_required"
          : !rate
            ? "reviewed_pricing_required"
            : !validOutput
              ? "output_allowlist_required"
              : !live
                ? "live_validation_required"
                : null;
    engines[id] = {
      id,
      key,
      rate,
      model,
      outputPrefixes,
      verified: live,
      verifiedCases: cases,
      enabled: reason === null,
      reason,
    };
  }
  return {
    enabled: env.AI_MULTI_ENGINE_ENABLED === "1",
    openaiEnabled: env.AI_OPENAI_ENABLED !== "0",
    engines,
  };
}
export function chooseRoute(
  registry: Registry,
  input: JobInput,
  source: { width: number; height: number },
  openaiModel: string,
): EngineRoute | null {
  if (!input.processing) return null; // Preserve the exact legacy submission fingerprint and worker behavior.
  if (!registry.enabled)
    throw new AppError(
      503,
      "processing_engine_disabled",
      "Additional processing engines are not activated.",
    );
  const s = input.processing;
  const candidates =
    s.engine === "auto"
      ? s.experience === "authentic"
        ? s.operation === "upscale"
          ? ["topaz", "claid"]
          : ["topaz"]
        : s.operation === "product_finish"
          ? ["claid"]
          : ["openai"]
      : [s.engine];
  const provider = candidates.find((id) =>
    id === "openai"
      ? registry.openaiEnabled
      : registry.engines[id as "topaz" | "claid"]?.enabled &&
        registry.engines[id as "topaz" | "claid"].verifiedCases.includes(
          `${s.operation}:${s.scale}`,
        ),
  ) as EngineId | undefined;
  if (!provider)
    throw new AppError(
      503,
      "processing_engine_disabled",
      "No verified engine is available for this operation.",
    );
  if (provider !== s.consented_engine)
    throw new AppError(
      409,
      "processing_consent_changed",
      "The selected provider changed. Review the engine and give permission again.",
    );
  if (
    s.experience === "authentic" &&
    (provider === "openai" ||
      s.operation === "product_finish" ||
      input.background !== "preserve" ||
      input.framing !== "match" ||
      input.brand ||
      input.instructions ||
      input.product_options)
  )
    throw new AppError(
      400,
      "authentic_operation",
      "Authentic Enhancement preserves the full source. Background changes, reframing, brand overlays and creative instructions require Creative Production.",
    );
  if (provider === "topaz" && s.experience !== "authentic")
    throw new AppError(
      400,
      "processing_operation",
      "Topaz precision enhancement is reserved for Authentic Enhancement.",
    );
  if (
    provider === "claid" &&
    (input.instructions ||
      input.brand ||
      input.product_options ||
      (s.experience === "creative" &&
        (input.mode !== "product" ||
          s.operation !== "product_finish" ||
          input.framing !== "match")))
  )
    throw new AppError(
      400,
      "processing_operation",
      "Claid supports the fixed product finish or source-preserving upscale. Use OpenAI for instructions, creative scenes and brand layouts.",
    );
  if (
    provider === "claid" &&
    s.experience === "authentic" &&
    s.operation !== "upscale"
  )
    throw new AppError(
      400,
      "processing_operation",
      "The Claid authentic path supports precision resizing only. Choose Topaz for enhancement.",
    );
  if (provider === "openai") {
    if (s.scale !== 1 || s.operation !== "enhance")
      throw new AppError(
        400,
        "processing_operation",
        "OpenAI creative edits use the existing canvas controls.",
      );
    return null;
  }
  if (s.operation !== "upscale" && s.scale !== 1)
    throw new AppError(
      400,
      "processing_operation",
      "Choose Upscale to change the output resolution.",
    );
  const width = source.width * s.scale,
    height = source.height * s.scale;
  const c = registry.engines[provider],
    rate = c.rate!;
  if (
    width * height > rate.max_output_pixels ||
    width > 10000 ||
    height > 10000
  )
    throw new AppError(
      400,
      "processing_dimensions",
      "The requested output exceeds the reviewed resolution limit. Choose a smaller scale.",
    );
  const estimate = Math.ceil(
    Math.max(
      rate.minimum_micro_usd,
      rate.micro_usd * (rate.unit === "operation" ? 1 : (width * height) / 1e6),
    ),
  );
  const base = {
    version: ADAPTER_VERSION as typeof ADAPTER_VERSION,
    provider,
    model: provider === "topaz" ? topazModel(s.operation) : c.model,
    experience: s.experience,
    operation: s.operation,
    size: `${width}x${height}`,
    rate,
    estimate_micro_usd: estimate,
    reserve_micro_usd: Math.ceil(estimate * rate.reserve_multiplier),
  };
  return { ...base, route_hash: routeDigest(base) };
}
export function engineCapabilities(registry: Registry, ready = true) {
  return {
    multi_engine_enabled: registry.enabled,
    engines: [
      {
        id: "openai",
        enabled: registry.openaiEnabled && ready,
        experience: "creative",
        reason: registry.openaiEnabled ? null : "disabled",
      },
      ...Object.values(registry.engines).map((e) => ({
        id: e.id,
        enabled: e.enabled && ready,
        verified_cases: e.verifiedCases,
        live_verified: e.verified,
        reason: e.reason,
        experience: e.id === "topaz" ? "authentic" : "authentic_and_creative",
        model: e.model,
      })),
    ],
  };
}
