import { loadEngineRegistry } from "./engine-registry.js";
import { z } from "zod";
const money = z.coerce.number().finite().positive().max(10000);
const schema = z.object({
  AI_OPENAI_API_KEY: z.string().min(1).max(4096),
  AI_IMAGE_MODEL: z
    .enum([
      "gpt-image-2.5-flare-2026-09-08",
      "gpt-image-2.5-sunburst-2026-09-08",
      "gpt-image-1.5",
    ])
    .default("gpt-image-2.5-sunburst-2026-09-08"),
  AI_MAX_QUALITY: z.enum(["low", "medium", "high"]).default("high"),
  AI_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
  AI_GLOBAL_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  AI_USER_DAILY_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  AI_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
  AI_OPERATION_RESERVE_USD: money,
  AI_USER_DAILY_BUDGET_USD: money,
  AI_GLOBAL_DAILY_BUDGET_USD: money,
  AI_PRICE_VERSION: z.string().trim().min(5).max(100),
  AI_TEXT_INPUT_USD_PER_MILLION: money,
  AI_IMAGE_INPUT_USD_PER_MILLION: money,
  AI_TEXT_OUTPUT_USD_PER_MILLION: z.preprocess(
    (value) => (value === "" ? undefined : value),
    money.optional(),
  ),
  AI_IMAGE_OUTPUT_USD_PER_MILLION: money,
});
export type ProcessingConfig = z.infer<typeof schema>;
export function loadProcessingConfig(env: NodeJS.ProcessEnv = process.env): {
  config: ProcessingConfig | null;
  missing: string[];
} {
  if (env.AI_PROCESSING_ENABLED !== "1")
    return { config: null, missing: ["AI_PROCESSING_ENABLED"] };
  const openai = env.AI_OPENAI_ENABLED !== "0";
  // Disabled OpenAI fields are inert, never submitted or used as price estimates.
  // Dedicated providers have their own required, reviewed prices and secrets.
  const result = openai
    ? schema.safeParse(env)
    : schema
        .extend({
          AI_OPENAI_API_KEY: z.literal(""),
          AI_PRICE_VERSION: z.literal("not_applicable"),
          AI_TEXT_INPUT_USD_PER_MILLION: z.literal(0),
          AI_IMAGE_INPUT_USD_PER_MILLION: z.literal(0),
          AI_TEXT_OUTPUT_USD_PER_MILLION: z.literal(0),
          AI_IMAGE_OUTPUT_USD_PER_MILLION: z.literal(0),
        })
        .safeParse({
          ...env,
          AI_OPENAI_API_KEY: "",
          AI_PRICE_VERSION: "not_applicable",
          AI_TEXT_INPUT_USD_PER_MILLION: 0,
          AI_IMAGE_INPUT_USD_PER_MILLION: 0,
          AI_TEXT_OUTPUT_USD_PER_MILLION: 0,
          AI_IMAGE_OUTPUT_USD_PER_MILLION: 0,
        });
  if (
    !result.success &&
    openai &&
    Object.values(loadEngineRegistry(env).engines).some(
      (engine) => engine.enabled,
    )
  ) {
    // A misconfigured OpenAI adapter must not disable a separately verified
    // dedicated provider. Shared budgets still have to validate below.
    return loadProcessingConfig({ ...env, AI_OPENAI_ENABLED: "0" });
  }
  return result.success
    ? { config: result.data, missing: [] }
    : {
        config: null,
        missing: [
          ...new Set(result.error.issues.map((i) => String(i.path[0]))),
        ],
      };
}
export function priceSnapshot(c: ProcessingConfig) {
  return {
    version: c.AI_PRICE_VERSION,
    model: c.AI_IMAGE_MODEL,
    text_input: c.AI_TEXT_INPUT_USD_PER_MILLION,
    image_input: c.AI_IMAGE_INPUT_USD_PER_MILLION,
    text_output: c.AI_TEXT_OUTPUT_USD_PER_MILLION,
    image_output: c.AI_IMAGE_OUTPUT_USD_PER_MILLION,
    basis: "configured_uncached_token_estimate",
    ...(c.AI_IMAGE_MODEL.startsWith("gpt-image-2.5-")
      ? { output_modality: "image" }
      : {}),
  };
}
export function limits(c: ProcessingConfig) {
  return {
    user_active: 1,
    user_daily: c.AI_USER_DAILY_LIMIT,
    global_daily: c.AI_GLOBAL_DAILY_LIMIT,
    user_budget: Math.floor(c.AI_USER_DAILY_BUDGET_USD * 1e6),
    global_budget: Math.floor(c.AI_GLOBAL_DAILY_BUDGET_USD * 1e6),
  };
}
