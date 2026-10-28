import sharp from "sharp";
import type { BrandSnapshot } from "./contracts.js";
import type { QualityCheck } from "../quality/contracts.js";
export async function assessBrandLayout(
  output: Buffer,
  brand: BrandSnapshot,
): Promise<QualityCheck[]> {
  const checks: QualityCheck[] = [];
  if (brand.settings.logo_placement === "footer") {
    const { data, info } = await sharp(output)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const expected = brand.settings.secondary_color
      .slice(1)
      .match(/../g)!
      .map((n) => parseInt(n, 16));
    const corners = [
      (info.height * info.width - info.width) * info.channels,
      (info.height * info.width - 1) * info.channels,
    ];
    const matches = corners.every((p) =>
      expected.every((c, i) => Math.abs(data[p + i] - c) <= 1),
    );
    checks.push({
      id: "brand_layout",
      label: "Composited brand-strip boundary",
      status: matches ? "passed" : "needs_review",
      method: "objective",
      confidence: null,
      explanation: matches
        ? "Both bottom boundary pixels match the saved strip color. This is a narrow boundary check; it does not verify logo legibility, placement on a marketplace or product fidelity."
        : "The strip boundary does not match its saved color. Review the footer and logo before use.",
    });
  }
  checks.push({
    id: "brand_adherence",
    label: "Brand styling & preservation review",
    status: "needs_review",
    method: "customer",
    confidence: null,
    explanation:
      "Review the saved brand background, palette, framing and spacing against the result. Canvas dimensions were checked separately. Exact palette, semantic framing, typography and product fidelity are not objectively certified. An enabled brand strip uses the uploaded asset directly, resized into a separate footer; confirm its appearance and legibility.",
  });
  return checks;
}
