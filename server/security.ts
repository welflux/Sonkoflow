import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    public publicMessage: string,
  ) {
    super(code);
  }
}
export const uuid = z.string().uuid();
export const audience = z.enum(["ecommerce", "professional", "individual"]);
export const credentials = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();
export const projectInput = z
  .object({ name: z.string().trim().min(1).max(100), audience })
  .strict();
export function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
export function opaque() {
  return randomBytes(32).toString("hex");
}
export function seal(value: unknown, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function unseal(value: string, key: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString(),
  );
}
export function rateKey(ip: string, bucket: string, key: string) {
  return createHmac("sha256", key).update(`${bucket}:${ip}`).digest("hex");
}
export async function validateImage(bytes: Buffer) {
  if (bytes.length > 10 * 1024 * 1024)
    throw new AppError(413, "upload_size", "Images must be 10 MB or smaller.");
  try {
    const processor = sharp(bytes, {
      limitInputPixels: 25_000_000,
      failOn: "warning",
      animated: false,
    });
    const meta = await processor.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) > 1 ||
      !meta.width ||
      !meta.height ||
      meta.width < 64 ||
      meta.height < 64
    )
      throw new Error("format");
    const output = await processor
      .rotate()
      .webp({ quality: 92 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length > 10 * 1024 * 1024) throw new Error("output_size");
    return {
      bytes: output.data,
      width: output.info.width,
      height: output.info.height,
      checksum: hash(output.data),
    };
  } catch {
    throw new AppError(
      400,
      "invalid_image",
      "Use a valid, non-animated JPEG, PNG, or WebP between 64 pixels and 25 megapixels.",
    );
  }
}
