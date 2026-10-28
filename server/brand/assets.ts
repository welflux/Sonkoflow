import sharp from "sharp";
import { AppError, hash } from "../security.js";
import type { BrandSnapshot } from "./contracts.js";
export async function validateAsset(bytes: Buffer, mime: string) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(mime) ||
    !bytes.length ||
    bytes.length > 2 * 1024 * 1024
  )
    throw new AppError(
      400,
      "brand_asset_invalid",
      "Choose a PNG, JPEG or WebP asset up to 2 MB. SVG and animated images are not supported.",
    );
  try {
    const m = await sharp(bytes, {
      limitInputPixels: 8_000_000,
      failOn: "warning",
    }).metadata();
    if (
      !m.width ||
      !m.height ||
      Math.min(m.width, m.height) < 16 ||
      (m.pages ?? 1) !== 1 ||
      !["png", "jpeg", "webp"].includes(m.format ?? "") ||
      `image/${m.format}` !== mime
    )
      throw Error();
    const { data, info } = await sharp(bytes, {
      limitInputPixels: 8_000_000,
      failOn: "warning",
    })
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toColourspace("srgb")
      .webp({ lossless: true })
      .toBuffer({ resolveWithObject: true });
    if (data.length > 2 * 1024 * 1024) throw Error();
    return {
      bytes: data,
      width: info.width,
      height: info.height,
      checksum: hash(data),
      byte_size: data.length,
    };
  } catch {
    throw new AppError(
      400,
      "brand_asset_invalid",
      "The asset could not be decoded safely. Use one still image, at least 16 × 16 pixels and at most 8 megapixels.",
    );
  }
}
export function footerLayout(
  width: number,
  height: number,
  s: BrandSnapshot["settings"],
) {
  const band = Math.round(height * 0.14),
    pad = Math.round(width * 0.025);
  return { band, pad, top: height - band, background: s.secondary_color };
}
export async function compositeBrand(
  bytes: Buffer,
  logo: Buffer,
  snapshot: BrandSnapshot,
) {
  if (snapshot.settings.logo_placement !== "footer" || !snapshot.logo)
    return bytes;
  if (hash(logo) !== snapshot.logo.checksum) throw new Error("brand_asset");
  const m = await sharp(bytes).metadata();
  if (!m.width || !m.height) throw new Error("brand_output");
  const { band, pad, top, background } = footerLayout(
    m.width,
    m.height,
    snapshot.settings,
  );
  const photograph = await sharp(bytes)
    .resize({ width: m.width, height: top, fit: "contain", background })
    .webp({ lossless: true })
    .toBuffer();
  const stamp = await sharp(logo)
    .resize({
      width: Math.floor(m.width * 0.3),
      height: band - pad * 2,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const align = snapshot.settings.logo_align;
  const left =
    align === "left"
      ? pad
      : align === "center"
        ? Math.round((m.width - stamp.info.width) / 2)
        : m.width - pad - stamp.info.width;
  return sharp({
    create: { width: m.width, height: m.height, channels: 4, background },
  })
    .composite([
      { input: photograph, left: 0, top: 0 },
      {
        input: stamp.data,
        left,
        top: top + Math.floor((band - stamp.info.height) / 2),
      },
    ])
    .webp({ lossless: true })
    .toBuffer();
}
