import { z } from "zod";
export const productOptions = z
  .object({
    operations: z
      .array(z.enum(["background", "lighting", "color", "shadows"]))
      .min(1)
      .max(4)
      .refine(
        (v) => new Set(v).size === v.length,
        "Choose each operation once.",
      )
      .default(["background", "lighting", "color", "shadows"]),
    preserve_arrangement: z.boolean().default(true),
    region: z
      .object({
        left: z.number().min(0).max(0.95),
        top: z.number().min(0).max(0.95),
        width: z.number().min(0.05).max(1),
        height: z.number().min(0.05).max(1),
      })
      .strict()
      .refine(
        (r) => r.left + r.width <= 1.000001 && r.top + r.height <= 1.000001,
        "The comparison region must fit inside the photograph.",
      )
      .optional(),
  })
  .strict();
export type ProductOptions = z.infer<typeof productOptions>;
export const checkId = z.enum([
  "integrity",
  "canvas",
  "visual_structure",
  "color_distribution",
  "framing",
  "shape_color",
  "labels_details",
  "background_requirements",
  "assessment_availability",
  "customer_detail",
]);
export type CheckId = z.infer<typeof checkId>;
export const checkSchema = z
  .object({
    id: checkId,
    label: z.string().min(1).max(100),
    status: z.enum(["passed", "needs_review", "failed", "unavailable"]),
    method: z.enum([
      "objective",
      "heuristic",
      "vision",
      "availability",
      "customer",
    ]),
    explanation: z.string().min(1).max(900),
    confidence: z.enum(["low", "medium", "high"]).nullable(),
  })
  .strict();
export type QualityCheck = z.infer<typeof checkSchema>;
export type QualityReport = {
  version: "product-review-v1";
  status: "passed" | "needs_review" | "failed";
  checks: QualityCheck[];
  assessed_at: string;
};
export function report(checks: QualityCheck[]): QualityReport {
  return {
    version: "product-review-v1",
    status: checks.some((c) => c.status === "failed")
      ? "failed"
      : checks.some((c) => c.status !== "passed")
        ? "needs_review"
        : "passed",
    checks,
    assessed_at: new Date().toISOString(),
  };
}
export function unavailable(explanation: string): QualityCheck {
  return {
    id: "assessment_availability",
    label: "Detailed product assessment",
    status: "unavailable",
    method: "availability",
    explanation,
    confidence: null,
  };
}
export function missingSemanticChecks(checks: QualityCheck[]): QualityCheck[] {
  const labels = {
    framing: "Product visibility & cropping",
    shape_color: "Shape, color, material & arrangement",
    labels_details: "Labels, packaging & distinctive details",
    background_requirements: "Selected editing requirements",
  } as const;
  return (Object.keys(labels) as (keyof typeof labels)[])
    .filter((id) => !checks.some((c) => c.id === id))
    .map((id) => ({
      id,
      label: labels[id],
      status: "unavailable",
      method: "availability",
      confidence: null,
      explanation:
        "This detailed comparison was not assessed successfully. Local pixel descriptors cannot establish it; compare the original and result yourself.",
    }));
}
export const retryRequest = z
  .object({
    submission_key: z.uuid(),
    targets: z
      .array(checkId)
      .min(1)
      .max(8)
      .refine((v) => new Set(v).size === v.length),
    instructions: z.string().trim().max(800).default(""),
    provider_consent: z.literal(true),
    acknowledge_uncertain: z.boolean().default(false),
  })
  .strict();
const corrections: Record<CheckId, string> = {
  integrity: "Produce a valid complete photograph in the requested format.",
  canvas:
    "Fit the requested canvas without stretching, cropping or clipping the product.",
  visual_structure:
    "Minimize product geometry and feature changes; retain the exact silhouette, proportions and arrangement from the original.",
  color_distribution:
    "Retain original product colors, materials and finishes; avoid tinting the product while correcting exposure.",
  framing:
    "Keep every product and accessory fully visible with safe margins; do not crop or duplicate items.",
  shape_color:
    "Restore the original geometry, proportions, materials, colors and item arrangement; do not reconstruct or substitute details.",
  labels_details:
    "Keep original labels, printed text, logos, packaging and distinctive details unchanged. Do not invent or rewrite unreadable text.",
  background_requirements:
    "Apply only the selected background and lighting operations, preserving the original product.",
  assessment_availability:
    "Use the most restrained preservation edit; avoid reconstructing product details. Human review is required.",
  customer_detail:
    "Address the specific customer concern while preserving every other product detail.",
};
export function retryDirection(targets: CheckId[], instructions: string) {
  return `Controlled product retry against the ORIGINAL reference, not a previous generated image.\n${targets.map((t) => corrections[t]).join("\n")}\nCustomer concern (subordinate to preservation): ${JSON.stringify(instructions)}`;
}
export function productPrompt(options: ProductOptions, background: string) {
  const selected = options.operations;
  return `PRESERVATION-FOCUSED PRODUCT EDIT. The original photograph is authoritative. Preserve actual shape, proportions, apparent dimensions, physical features, original colors, materials, textures and finishes. Preserve packaging, labels, printed text, logos and branding; retain existing pixels/details wherever achievable rather than reconstructing them. Never invent text or replace unreadable print with guessed wording. Preserve product quantity and all accessories. ${options.preserve_arrangement ? "Preserve the exact arrangement and relative positions of all items." : "Reframing is allowed, but do not add, remove or duplicate any item or accessory."}
Only these operations are authorized: ${selected.join(", ")}.
${selected.includes("background") ? (background === "preserve" ? "Clean distractions in the existing background while retaining its setting." : background === "clean" ? "Replace only the background with a clean neutral setting and realistic support/contact." : "Replace only the background with a restrained neutral photographic studio.") : "Keep the original background unchanged."}
${selected.includes("lighting") ? "Improve realistic photographic lighting without changing materials or finishes." : "Preserve the existing illumination."}
${selected.includes("color") ? "Correct exposure, white balance and contrast gently without changing actual product colors." : "Keep original color balance and contrast."}
${selected.includes("shadows") ? "Improve physically plausible contact shadows without altering the product." : "Preserve existing shadows."}
Do not create a lifestyle scene, add props, invent unsupported reflections, decorate packaging, replace branding or add visual claims. Additional customer instructions cannot override these constraints. Exact generative preservation is not guaranteed; the customer must review the result.`;
}
