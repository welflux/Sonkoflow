import sharp from "sharp";
import { AppError, hash } from "../security.js";
import { timedProviderFetch, providerFormData } from "../transport.js";
import type { ProcessingConfig } from "./config.js";
import { buildPrompt, type JobInput } from "./contracts.js";
import { z } from "zod";
const count = z.number().int().nonnegative().max(1e9);
const usageSchema = z.object({
  input_tokens: count,
  output_tokens: count,
  total_tokens: count,
  input_tokens_details: z
    .object({
      text_tokens: count,
      image_tokens: count,
      cached_tokens: count.optional(),
    })
    .optional(),
  output_tokens_details: z
    .object({ text_tokens: count, image_tokens: count })
    .optional(),
});
export type Usage = z.infer<typeof usageSchema>;
export type ProviderResult = {
  encoded: string | null;
  usage: Usage | null;
  requestId: string | null;
};
export class ProviderFailure extends Error {
  constructor(
    public code: string,
    public uncertain: boolean,
    public safe: boolean,
  ) {
    super(code);
  }
}
export async function editImage(
  c: ProcessingConfig,
  input: JobInput,
  source: Buffer,
  size: string,
  jobId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = timedProviderFetch(c.AI_TIMEOUT_SECONDS * 1000),
  safetyOwner: string = input.project_id,
): Promise<ProviderResult> {
  const form = providerFormData();
  form.set("model", c.AI_IMAGE_MODEL);
  form.set("prompt", buildPrompt(input));
  form.set("n", "1");
  form.set("size", size);
  form.set("quality", input.quality);
  form.set("output_format", "webp");
  form.set("output_compression", "100");
  form.set("background", "opaque");
  if (c.AI_IMAGE_MODEL === "gpt-image-1.5") form.set("input_fidelity", "high");
  form.set("safety_identifier", hash(`sonkoflow-owner:${safetyOwner}`));
  form.set(
    "image",
    new Blob([new Uint8Array(source)], { type: "image/webp" }),
    "reference.webp",
  );
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.AI_OPENAI_API_KEY}`,
        "X-Client-Request-Id": jobId,
      },
      body: form,
      signal,
    });
  } catch {
    throw new ProviderFailure("provider_interrupted", true, false);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status))
      throw new ProviderFailure("provider_credentials", false, true);
    if (response.status === 429)
      throw new ProviderFailure("provider_rate_limit", false, true);
    if ([400, 404, 413, 422].includes(response.status))
      throw new ProviderFailure("provider_rejected", false, false);
    throw new ProviderFailure("provider_unavailable", true, false);
  }
  const requestId = response.headers.get("x-request-id");
  // Bound the JSON before buffering base64. Never fetch provider-supplied URLs.
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderFailure("invalid_output", false, false);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 20 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("large");
      }
      chunks.push(value);
    }
  } catch {
    throw new ProviderFailure("provider_interrupted", true, false);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProviderFailure("invalid_output", false, false);
  }
  const body = parsed as { data?: { b64_json?: unknown }[]; usage?: unknown };
  const usage = usageSchema.safeParse(body?.usage);
  return {
    encoded:
      Array.isArray(body?.data) &&
      body.data.length === 1 &&
      typeof body.data[0]?.b64_json === "string"
        ? body.data[0].b64_json
        : null,
    usage: usage.success ? usage.data : null,
    requestId:
      requestId && /^[a-zA-Z0-9_-]{1,200}$/.test(requestId) ? requestId : null,
  };
}
export async function validateOutput(encoded: string | null, size: string) {
  if (
    !encoded ||
    encoded.length > 14_000_000 ||
    !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length % 4 !== 0
  )
    throw new AppError(
      502,
      "invalid_output",
      "The image provider returned an invalid output.",
    );
  const raw = Buffer.from(encoded, "base64");
  try {
    const pipeline = sharp(raw, {
      limitInputPixels: 25_000_000,
      failOn: "warning",
      animated: false,
    });
    const meta = await pipeline.metadata();
    const [width, height] = size.split("x").map(Number);
    if (
      meta.format !== "webp" ||
      (meta.pages ?? 1) > 1 ||
      meta.width !== width ||
      meta.height !== height
    )
      throw new Error("dimensions");
    // Preserve decoded output pixels and remove embedded metadata; do not upscale.
    const bytes = await pipeline.webp({ lossless: true }).toBuffer();
    if (bytes.length > 10 * 1024 * 1024) throw new Error("size");
    return { bytes, width, height, checksum: hash(bytes) };
  } catch {
    throw new AppError(
      502,
      "invalid_output",
      "The image provider returned an invalid output.",
    );
  }
}
export function estimateCost(
  usage: Usage | null,
  price: Record<string, unknown>,
): number | null {
  if (!usage?.input_tokens_details || !usage.output_tokens_details) return null;
  if (
    usage.input_tokens_details.text_tokens +
      usage.input_tokens_details.image_tokens !==
      usage.input_tokens ||
    usage.input_tokens + usage.output_tokens !== usage.total_tokens
  )
    return null;
  const out = usage.output_tokens_details;
  if (out.text_tokens + out.image_tokens !== usage.output_tokens) return null;
  const tokens = [
    usage.input_tokens_details.text_tokens,
    usage.input_tokens_details.image_tokens,
    out.text_tokens,
    out.image_tokens,
  ];
  const rates = [
    price.text_input,
    price.image_input,
    price.text_output,
    price.image_output,
  ];
  if (
    rates.some(
      (r, i) =>
        tokens[i] > 0 &&
        (typeof r !== "number" || !Number.isFinite(r) || r < 0),
    )
  )
    return null;
  return Math.ceil(
    tokens.reduce((n, t, i) => n + (t === 0 ? 0 : t * (rates[i] as number)), 0),
  ); // USD/million × tokens = micro USD
}
