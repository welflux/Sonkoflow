import type { ProcessingEngine } from "../processing/engine.js";
import type { JobInput } from "../processing/contracts.js";
import { buildPrompt, outputSize } from "../processing/contracts.js";
import { AppError } from "../security.js";
import type { Identity } from "../services.js";
import type { BrandSnapshot } from "../brand/contracts.js";
export async function meterPlan(
  engine: ProcessingEngine,
  input: JobInput,
  source: { width: number; height: number },
  identity: Identity,
  brand?: BrandSnapshot,
  controlled_retry = "",
) {
  if (!engine.billing) return null;
  const account = await engine.billing.account(identity),
    tier = account.plan,
    c = engine.config!,
    pc = engine.packConfig;
  if (
    !pc ||
    pc.AI_PACK_CREDIT_MICRO_USD !== 10000 ||
    pc.AI_PACK_INITIAL_CREDITS !== 0 ||
    pc.AI_PACK_TOKEN_ESTIMATES_JSON.model !== c.AI_IMAGE_MODEL
  )
    throw new AppError(
      503,
      "billing_estimates",
      "Reviewed cost estimates and a matching unit configuration are required.",
    );
  if (
    source.width * source.height >
    pc.AI_PACK_TOKEN_ESTIMATES_JSON.max_source_pixels
  )
    throw new AppError(
      400,
      "billing_source_limit",
      "This reference exceeds the reviewed cost-estimate range.",
    );
  const size = outputSize(input, source.width, source.height),
    prompt = buildPrompt({ ...input, brand_snapshot: brand, controlled_retry }),
    table = pc.AI_PACK_TOKEN_ESTIMATES_JSON;
  const outputTokens =
    table.output_image_tokens[input.quality][
      size === "1024x1024" ? "square" : "landscape"
    ] * (size === "1024x1536" ? 1.25 : 1);
  const estimated = Math.ceil(
    Buffer.byteLength(prompt) * c.AI_TEXT_INPUT_USD_PER_MILLION +
      table.input_image_tokens * c.AI_IMAGE_INPUT_USD_PER_MILLION +
      outputTokens * c.AI_IMAGE_OUTPUT_USD_PER_MILLION,
  );
  const vision =
    input.mode === "product" && tier !== "free" ? engine.quality.vision : null;
  if (vision && !pc.AI_PACK_VISION_INPUT_TOKEN_ESTIMATE)
    throw new AppError(
      503,
      "billing_estimates",
      "Assessment cost estimates are required.",
    );
  const assessment = vision
    ? Math.ceil(
        pc.AI_PACK_VISION_INPUT_TOKEN_ESTIMATE! *
          vision.AI_QUALITY_INPUT_USD_PER_MILLION +
          1500 * vision.AI_QUALITY_OUTPUT_USD_PER_MILLION,
      )
    : 0;
  const reserve = Math.ceil(
      Math.max(
        tier === "free" ? 0 : c.AI_OPERATION_RESERVE_USD * 1e6,
        estimated * 2,
      ),
    ),
    assessmentReserve = vision
      ? Math.ceil(Math.max(vision.AI_QUALITY_RESERVE_USD * 1e6, assessment * 2))
      : 0;
  const plan = {
    unit_micro_usd: 10000,
    generation_credits: Math.ceil(reserve / 10000),
    assessment_credits: Math.ceil(assessmentReserve / 10000),
    estimated_credits:
      Math.ceil(estimated / 10000) + Math.ceil(assessment / 10000),
    estimated_micro_usd: estimated + assessment,
    version: table.version,
  };
  if (
    tier === "free" &&
    (input.quality !== "low" ||
      size !== "1024x1024" ||
      brand ||
      plan.generation_credits > 20)
  )
    throw new AppError(
      409,
      "billing_entitlement",
      "Your sample supports one low-quality square edit within its 20-unit cost budget.",
    );
  if (["starter", "payg"].includes(tier) && input.quality === "high")
    throw new AppError(
      409,
      "billing_entitlement",
      "High quality requires Pro. Choose Low or Medium.",
    );
  return {
    plan,
    tier,
    account,
    reserved_micro_usd: reserve + assessmentReserve,
    quality_reserved_micro_usd: assessmentReserve,
    vision,
  };
}
