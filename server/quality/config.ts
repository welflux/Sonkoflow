import { z } from "zod";
const schema = z.object({
  AI_OPENAI_API_KEY: z.string().min(1).max(4096),
  AI_QUALITY_VISION_MODEL: z.literal("gpt-6.1-terra").default("gpt-6.1-terra"),
  AI_QUALITY_RESERVE_USD: z.coerce.number().finite().positive().max(10),
  AI_QUALITY_INPUT_USD_PER_MILLION: z.coerce
    .number()
    .finite()
    .positive()
    .max(1000),
  AI_QUALITY_OUTPUT_USD_PER_MILLION: z.coerce
    .number()
    .finite()
    .positive()
    .max(1000),
  AI_QUALITY_PRICE_VERSION: z.string().trim().min(5).max(100),
});
export type VisionConfig = z.infer<typeof schema>;
export function qualityConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  return {
    retryLimit: z.coerce
      .number()
      .int()
      .min(0)
      .max(5)
      .default(2)
      .catch(0)
      .parse(env.AI_PRODUCT_RETRY_LIMIT),
    vision:
      env.AI_QUALITY_VISION_ENABLED === "1" && parsed.success
        ? parsed.data
        : null,
  };
}
export function visionPrice(c: VisionConfig) {
  return {
    model: c.AI_QUALITY_VISION_MODEL,
    version: c.AI_QUALITY_PRICE_VERSION,
    input: c.AI_QUALITY_INPUT_USD_PER_MILLION,
    output: c.AI_QUALITY_OUTPUT_USD_PER_MILLION,
  };
}
