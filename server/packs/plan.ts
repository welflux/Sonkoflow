import { hash, AppError } from "../security.js";
import { buildPrompt } from "../processing/contracts.js";
import { priceSnapshot, type ProcessingConfig } from "../processing/config.js";
import { visionPrice, type VisionConfig } from "../quality/config.js";
import { type PackConfig } from "./config.js";
import {
  outputSpecs,
  packType,
  PACK_PROMPT_VERSION,
  type PackInput,
  type PackType,
  type PackContext,
} from "./contracts.js";
export function makeOutputPlan(
  type: PackType,
  quality: "low" | "medium" | "high",
  input: Pick<PackInput, "scene" | "detail_focus" | "instructions">,
  c: ProcessingConfig,
  q: VisionConfig | null,
  pc: PackConfig,
  retryLimit: number,
  controlledRetry = "",
) {
  if (pc.AI_PACK_TOKEN_ESTIMATES_JSON.model !== c.AI_IMAGE_MODEL)
    throw new AppError(
      503,
      "pack_estimates_required",
      "Pack token estimates must match the selected image model.",
    );
  if (
    ["low", "medium", "high"].indexOf(quality) >
    ["low", "medium", "high"].indexOf(c.AI_MAX_QUALITY)
  )
    throw new AppError(
      400,
      "quality_limit",
      "Choose an enabled output quality.",
    );
  if (q && !pc.AI_PACK_VISION_INPUT_TOKEN_ESTIMATE)
    throw new AppError(
      503,
      "pack_estimates_required",
      "Vision assessment estimates must be configured before packs can be quoted.",
    );
  const spec = outputSpecs[type],
    context: PackContext = {
      type,
      scene: input.scene,
      detail_focus: input.detail_focus,
    };
  const product_options = {
    operations: ["background", "lighting", "color", "shadows"] as (
      | "background"
      | "lighting"
      | "color"
      | "shadows"
    )[],
    preserve_arrangement: type === "listing",
  };
  const prompt = buildPrompt({
    mode: "product",
    instructions: input.instructions,
    background: "clean",
    product_options,
    pack_context: context,
    controlled_retry: controlledRetry,
  });
  // Explicit conservative estimate, not a claim of exact tokenizer/provider usage.
  const textTokens = Buffer.byteLength(prompt, "utf8");
  const outputTokens =
    pc.AI_PACK_TOKEN_ESTIMATES_JSON.output_image_tokens[quality][
      spec.aspect === "1:1" ? "square" : "landscape"
    ];
  const generationEstimate = Math.ceil(
    textTokens * c.AI_TEXT_INPUT_USD_PER_MILLION +
      pc.AI_PACK_TOKEN_ESTIMATES_JSON.input_image_tokens *
        c.AI_IMAGE_INPUT_USD_PER_MILLION +
      outputTokens * c.AI_IMAGE_OUTPUT_USD_PER_MILLION,
  );
  const assessmentEstimate = q
    ? Math.ceil(
        pc.AI_PACK_VISION_INPUT_TOKEN_ESTIMATE! *
          q.AI_QUALITY_INPUT_USD_PER_MILLION +
          1500 * q.AI_QUALITY_OUTPUT_USD_PER_MILLION,
      )
    : 0;
  const generationReserve = Math.ceil(
    Math.max(
      c.AI_OPERATION_RESERVE_USD * 1e6,
      generationEstimate * pc.AI_PACK_RESERVE_MULTIPLIER,
    ),
  );
  const assessmentReserve = q
    ? Math.ceil(
        Math.max(
          q.AI_QUALITY_RESERVE_USD * 1e6,
          assessmentEstimate * pc.AI_PACK_RESERVE_MULTIPLIER,
        ),
      )
    : 0;
  const unit = pc.AI_PACK_CREDIT_MICRO_USD;
  const creditPlan = {
    unit_micro_usd: unit,
    generation_credits: Math.ceil(generationReserve / unit),
    assessment_credits: Math.ceil(assessmentReserve / unit),
    estimated_credits:
      Math.ceil(generationEstimate / unit) +
      Math.ceil(assessmentEstimate / unit),
    estimated_micro_usd: generationEstimate + assessmentEstimate,
    version: pc.AI_PACK_TOKEN_ESTIMATES_JSON.version,
  };
  return {
    type,
    name: spec.name,
    creative: spec.creative,
    size: spec.size,
    aspect: spec.aspect,
    quality,
    estimated_credits: creditPlan.estimated_credits,
    reserved_credits:
      creditPlan.generation_credits + creditPlan.assessment_credits,
    estimated_micro_usd: creditPlan.estimated_micro_usd,
    job: {
      mode: "product",
      instructions: input.instructions,
      quality,
      output_size: spec.size,
      model: c.AI_IMAGE_MODEL,
      settings: {
        background: "clean",
        framing: spec.aspect === "1:1" ? "square" : "landscape",
        preserve_appearance: true,
        provider_consent: true,
        product_options,
        pack_context: context,
        controlled_retry: controlledRetry,
      },
      prompt_version: PACK_PROMPT_VERSION,
      price_snapshot: priceSnapshot(c),
      reserved_micro_usd: generationReserve + assessmentReserve,
      quality_model: q?.AI_QUALITY_VISION_MODEL ?? null,
      quality_price_snapshot: q ? visionPrice(q) : null,
      quality_reserved_micro_usd: assessmentReserve,
      quality_retry_limit: retryLimit,
      pack_output_type: type,
      pack_credit_plan: creditPlan,
    },
  };
}
export function makePackPlan(
  input: PackInput,
  source: { width: number; height: number; checksum: string },
  c: ProcessingConfig,
  q: VisionConfig | null,
  pc: PackConfig,
  retryLimit: number,
) {
  if (input.outputs.length > pc.AI_PACK_MAX_OUTPUTS)
    throw new AppError(
      400,
      "pack_limit",
      "Choose fewer outputs for this pack.",
    );
  if (
    source.width * source.height >
    pc.AI_PACK_TOKEN_ESTIMATES_JSON.max_source_pixels
  )
    throw new AppError(
      400,
      "pack_estimates_required",
      "This reference exceeds the input range covered by the configured pack estimates.",
    );
  const outputs = [...input.outputs]
    .sort(
      (a, b) =>
        packType.options.indexOf(a.type) - packType.options.indexOf(b.type),
    )
    .map((o) => makeOutputPlan(o.type, o.quality, input, c, q, pc, retryLimit));
  return {
    outputs,
    estimated_credits: outputs.reduce((n, o) => n + o.estimated_credits, 0),
    reserved_credits: outputs.reduce((n, o) => n + o.reserved_credits, 0),
    fingerprint: hash(
      JSON.stringify({
        outputs,
        source: source.checksum,
        unit: pc.AI_PACK_CREDIT_MICRO_USD,
      }),
    ),
    estimate_version: pc.AI_PACK_TOKEN_ESTIMATES_JSON.version,
    price_version: c.AI_PRICE_VERSION,
  };
}
