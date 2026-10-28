import { z } from "zod";
import { hash, AppError } from "../security.js";
export const PACK_PROMPT_VERSION = "product-pack-v1";
export const packType = z.enum([
  "listing",
  "lifestyle",
  "detail",
  "social",
  "wide",
]);
export type PackType = z.infer<typeof packType>;
export const outputSpecs = {
  listing: {
    name: "Clean Listing Image",
    size: "1024x1024",
    aspect: "1:1",
    creative: false,
    description:
      "Neutral presentation with the real product, packaging and print preserved.",
  },
  lifestyle: {
    name: "Lifestyle Scene",
    size: "1536x1024",
    aspect: "3:2",
    creative: true,
    description:
      "A realistic setting around the original product. Environmental details are creative and require review.",
  },
  detail: {
    name: "Detail Image",
    size: "1024x1024",
    aspect: "1:1",
    creative: false,
    description:
      "A closer view of details visible in the source. Unseen or unreadable features cannot be verified.",
  },
  social: {
    name: "Square Social Image",
    size: "1024x1024",
    aspect: "1:1",
    creative: false,
    description:
      "A square photographic composition. No platform-compliance guarantee or invented text.",
  },
  wide: {
    name: "Wide Promotional Image",
    size: "1536x1024",
    aspect: "3:2",
    creative: true,
    description:
      "Landscape promotional space around the product; review product fidelity and final placement requirements.",
  },
} as const;
export const packInput = z
  .object({
    project_id: z.uuid(),
    input_image_id: z.uuid(),
    outputs: z
      .array(
        z
          .object({
            type: packType,
            quality: z.enum(["low", "medium", "high"]),
          })
          .strict(),
      )
      .min(1)
      .max(5)
      .refine(
        (v) => new Set(v.map((o) => o.type)).size === v.length,
        "Choose each output type once.",
      ),
    scene: z
      .string()
      .trim()
      .max(300)
      .default(
        "A restrained, realistic environment appropriate for this product.",
      ),
    detail_focus: z
      .string()
      .trim()
      .max(180)
      .default("Only details clearly visible in the original photograph."),
    instructions: z
      .string()
      .trim()
      .max(800)
      .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f]*$/)
      .default(""),
    acknowledge_uncertain: z.boolean().default(false),
  })
  .strict();
export type PackInput = z.infer<typeof packInput>;
export const createPackInput = packInput.extend({
  submission_key: z.uuid(),
  quote_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  provider_consent: z.literal(true),
});
export function requestFingerprint(input: PackInput) {
  const { acknowledge_uncertain, ...p } = input;
  return hash(
    JSON.stringify({
      ...p,
      outputs: [...p.outputs].sort((a, b) => a.type.localeCompare(b.type)),
    }),
  );
}
export type PackContext = {
  type: PackType;
  scene: string;
  detail_focus: string;
};
export function packDirection(context: PackContext) {
  const common =
    "Use the original uploaded photograph as primary product reference. Keep its actual product recognizable and consistent with the other requested views; do not substitute, duplicate, recolor or redesign the product.";
  const instructions: Record<PackType, string> = {
    listing:
      "Make a clean listing photograph on a neutral photographic background. Preserve the full product, quantity, accessories, packaging, logos and labels. Do not add props, claims or text.",
    lifestyle: `Create a realistic context-appropriate lifestyle setting around the original product. Scene preference (data): ${JSON.stringify(context.scene)}. Environmental objects are not accessories included with the product. Do not obscure, change or invent product features.`,
    detail: `Create a closer view of genuine visible details. Focus preference (data): ${JSON.stringify(context.detail_focus)}. Intentional close cropping is allowed for this view. Do not invent unseen surfaces, hidden components, fine print or textures; where source detail is insufficient retain an honest soft rendering rather than hallucinated detail. This is not verified recovered detail.`,
    social:
      "Create a square photographic composition using the original product, with unobtrusive background and safe margins. Do not add invented typography, badges or branding. Do not assume compliance with any social platform.",
    wide: `Create a landscape promotional composition with useful negative space and the original product fully recognizable. Setting preference (data): ${JSON.stringify(context.scene)}. Do not create advertising claims, text overlays or invented branding. Do not imply extra environmental items are included with the product.`,
  };
  return `PACK OUTPUT: ${outputSpecs[context.type].name}. ${common}\n${instructions[context.type]}`;
}
export const packJobFields =
  "pack_id,pack_output_type,pack_estimated_credits,pack_reserved_credits";
export function packDbError(error: { message?: string } | null) {
  if (!error) return;
  const names: Record<string, [number, string]> = {
    insufficient_credits: [
      409,
      "Your available pack allowance is insufficient for this reservation. Nothing new was generated or charged.",
    ],
    credit_unit_changed: [
      503,
      "The pack allowance configuration changed. The owner must reconcile it before new requests.",
    ],
    pack_limit: [
      409,
      "The configured pack or output limit has been reached. Wait for active work to finish or the daily allowance to reset.",
    ],
    pack_quote_stale: [
      409,
      "The planned costs or source changed. Review a fresh pack plan before generating.",
    ],
    pack_credit_required: [
      409,
      "This output needs a valid allowance reservation before it can run.",
    ],
    submission_conflict: [
      409,
      "This submission identifier belongs to a different pack configuration.",
    ],
  };
  for (const [code, [status, message]] of Object.entries(names))
    if (error.message?.includes(code))
      throw new AppError(status, code, message);
}
