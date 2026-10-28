import { z } from "zod";
const tokens = z.number().int().min(1).max(10_000_000);
const estimates = z
  .object({
    model: z.string().min(1).max(100),
    version: z.string().min(5).max(100),
    max_source_pixels: z.number().int().min(4096).max(25_000_000),
    input_image_tokens: tokens,
    output_image_tokens: z.object({
      low: z.object({ square: tokens, landscape: tokens }),
      medium: z.object({ square: tokens, landscape: tokens }),
      high: z.object({ square: tokens, landscape: tokens }),
    }),
  })
  .strict();
const schema = z.object({
  AI_PACK_INITIAL_CREDITS: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .default(0),
  AI_PACK_CREDIT_MICRO_USD: z.coerce.number().int().min(1).max(1_000_000),
  AI_PACK_MAX_OUTPUTS: z.coerce.number().int().min(1).max(5).default(5),
  AI_PACK_ZIP_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  AI_PACK_DAILY_LIMIT: z.coerce.number().int().min(1).max(20).default(2),
  AI_PACK_ACTIVE_LIMIT: z.coerce.number().int().min(1).max(3).default(1),
  AI_PACK_RESERVE_MULTIPLIER: z.coerce
    .number()
    .finite()
    .min(1)
    .max(10)
    .default(1.5),
  AI_PACK_VISION_INPUT_TOKEN_ESTIMATE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .optional(),
  AI_PACK_TOKEN_ESTIMATES_JSON: z.preprocess((v) => {
    try {
      return typeof v === "string" ? JSON.parse(v) : v;
    } catch {
      return null;
    }
  }, estimates),
});
export type PackConfig = z.infer<typeof schema>;
export function loadPackConfig(
  env: NodeJS.ProcessEnv = process.env,
): PackConfig | null {
  if (env.AI_PACKS_ENABLED !== "1") return null;
  const r = schema.safeParse(env);
  return r.success ? r.data : null;
}
