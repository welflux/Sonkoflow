import sharp from "sharp";
import { report, type QualityCheck, type ProductOptions } from "./contracts.js";
// Normalized region descriptors are review signals, NOT foreground segmentation,
// OCR, dimensional metrology or a proof of product fidelity.
async function descriptor(bytes: Buffer, region?: ProductOptions["region"]) {
  const image = sharp(bytes, {
    limitInputPixels: 25_000_000,
    failOn: "warning",
  }).rotate();
  const m = await image.metadata();
  if (!m.width || !m.height || (m.pages ?? 1) > 1) throw new Error("image");
  if (region)
    image.extract({
      left: Math.floor(region.left * m.width),
      top: Math.floor(region.top * m.height),
      width: Math.max(1, Math.floor(region.width * m.width)),
      height: Math.max(1, Math.floor(region.height * m.height)),
    });
  const data = await image
    .resize(32, 32, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer();
  const histogram = new Array<number>(24).fill(0);
  const gray: number[] = [];
  for (let i = 0; i < 1024; i++) {
    for (let c = 0; c < 3; c++)
      histogram[c * 8 + Math.min(7, Math.floor(data[i * 3 + c] / 32))] +=
        1 / 3072;
    gray.push(
      0.2126 * data[i * 3] +
        0.7152 * data[i * 3 + 1] +
        0.0722 * data[i * 3 + 2],
    );
  }
  const edges: boolean[] = [];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 31; x++)
      edges.push(gray[y * 32 + x + 1] > gray[y * 32 + x]);
  return { histogram, edges, meta: m };
}
export async function localAssessment(
  source: Buffer,
  output: Buffer,
  size: string,
  options: ProductOptions,
) {
  const checks: QualityCheck[] = [];
  let a, b;
  try {
    a = await descriptor(source, options.region);
    b = await descriptor(output, options.region);
  } catch {
    return report([
      {
        id: "integrity",
        label: "Image readability & integrity",
        status: "failed",
        method: "objective",
        confidence: null,
        explanation:
          "One image could not be decoded safely. Review/download may be unavailable. No product-fidelity conclusion was made.",
      },
    ]);
  }
  checks.push({
    id: "integrity",
    label: "Image readability & format",
    status: b.meta.format === "webp" ? "passed" : "failed",
    method: "objective",
    confidence: null,
    explanation: `Both images decoded successfully. Result format: ${b.meta.format}. This verifies file readability, not product fidelity.`,
  });
  const [w, h] = size.split("x").map(Number);
  checks.push({
    id: "canvas",
    label: "Output canvas",
    status: b.meta.width === w && b.meta.height === h ? "passed" : "failed",
    method: "objective",
    confidence: null,
    explanation: `Result is ${b.meta.width} × ${b.meta.height}; requested ${w} × ${h}. Pixel dimensions do not establish recovered detail or real-world product dimensions.`,
  });
  const edgeDistance =
    a.edges.filter((v, i) => v !== b.edges[i]).length / a.edges.length;
  const colorDistance =
    a.histogram.reduce((n, v, i) => n + Math.abs(v - b.histogram[i]), 0) / 2;
  const scope = options.region
    ? "the selected normalized product region"
    : "the whole photograph, including its background";
  checks.push({
    id: "visual_structure",
    label: "Visual structure comparison",
    status: edgeDistance > 0.38 ? "needs_review" : "passed",
    method: "heuristic",
    confidence: null,
    explanation: `Directional edge disagreement in ${scope}: ${(edgeDistance * 100).toFixed(1)}%. ${edgeDistance > 0.38 ? "Substantial change merits a visual check; it is not a confirmed shape defect." : "No large structural change was flagged by this limited descriptor."} Reframing, lighting and background changes can alter it; missing labels or small details can go undetected.`,
  });
  checks.push({
    id: "color_distribution",
    label: "Color distribution comparison",
    status: colorDistance > 0.28 ? "needs_review" : "passed",
    method: "heuristic",
    confidence: null,
    explanation: `RGB histogram distance in ${scope}: ${(colorDistance * 100).toFixed(1)}%. ${colorDistance > 0.28 ? "Review original product colors; lighting/background changes may explain the difference." : "No large color-distribution shift was flagged."} This is not a color-calibrated measurement or proof of product preservation.`,
  });
  return report(checks);
}
