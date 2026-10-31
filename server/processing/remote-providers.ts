import sharp from "sharp";
import { setTimeout as delay } from "node:timers/promises";
import { timedProviderFetch, providerFormData } from "../transport.js";
import { ProviderFailure, type ProviderResult } from "./provider.js";
import type { EngineRoute, RemoteEngine } from "./engine-registry.js";
export type EngineUsage = {
  provider: string;
  operation: string;
  model: string;
  output_pixels: number;
  elapsed_ms: number;
  cost_basis: "configured_provider_rate_estimate";
  actual_cost_micro_usd: null;
  price_version: string;
  remote_job_id?: string;
};
export type RemoteResult = ProviderResult & {
  engineUsage: EngineUsage;
  estimatedCost: number;
};
export type Receipt = (id: string, usage: EngineUsage) => Promise<void>;
async function bounded(response: Response, max: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderFailure("invalid_output", true, false);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw Error("large");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    throw new ProviderFailure("provider_interrupted", true, false);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
async function json(response: Response) {
  try {
    return JSON.parse((await bounded(response, 512 * 1024)).toString("utf8"));
  } catch {
    throw new ProviderFailure("invalid_output", true, false);
  }
}
async function check(response: Response, accepted = false) {
  if (response.ok) return;
  await response.body?.cancel();
  const status = response.status;
  if (accepted) throw new ProviderFailure("provider_interrupted", true, false);
  if (status === 402)
    throw new ProviderFailure("provider_billing", false, true);
  if ([401, 403].includes(status))
    throw new ProviderFailure("provider_credentials", false, true);
  if (status === 429)
    throw new ProviderFailure("provider_rate_limit", false, true);
  if ([400, 404, 413, 422].includes(status))
    throw new ProviderFailure("provider_rejected", false, false);
  throw new ProviderFailure("provider_unavailable", true, false);
}
function identifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
    ? value
    : null;
}
export function allowedOutputURL(raw: unknown, engine: RemoteEngine) {
  if (typeof raw !== "string" || raw.length > 4096)
    throw new ProviderFailure("invalid_output", true, false);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ProviderFailure("invalid_output", true, false);
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    !engine.outputPrefixes.some((prefix) => {
      const p = new URL(prefix);
      return p.origin === u.origin && u.pathname.startsWith(p.pathname);
    })
  )
    throw new ProviderFailure("invalid_output", true, false);
  return u.href;
}
export async function processRemote(
  engine: RemoteEngine,
  route: EngineRoute,
  source: Buffer,
  signal: AbortSignal,
  receipt?: Receipt,
  fetcher: typeof fetch = timedProviderFetch(300_000),
  wait: (signal: AbortSignal) => Promise<unknown> = (s) =>
    delay(2000, undefined, { signal: s }),
): Promise<RemoteResult> {
  const started = Date.now(),
    [width, height] = route.size.split("x").map(Number);
  const usage: EngineUsage = {
    provider: engine.id,
    operation: route.operation,
    model: route.model,
    output_pixels: width * height,
    elapsed_ms: 0,
    cost_basis: "configured_provider_rate_estimate",
    actual_cost_micro_usd: null,
    price_version: route.rate!.version,
  };
  // Both dedicated APIs accept PNG; send source pixels, without a public source URL.
  const png = await sharp(source, {
    limitInputPixels: 25_000_000,
    animated: false,
    failOn: "warning",
  })
    .png()
    .toBuffer();
  const form = providerFormData();
  let endpoint: string, headers: Record<string, string>;
  if (engine.id === "topaz") {
    endpoint = `https://api.topazlabs.com/image/v1/${route.operation === "sharpen" ? "sharpen" : route.operation === "denoise" ? "denoise" : "enhance"}/async`;
    headers = { "X-API-KEY": engine.key };
    form.set(
      "image",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      "original.png",
    );
    form.set("model", route.model);
    form.set("outputFormat", "png");
    if (route.operation === "sharpen") form.set("strength", "0.3");
    else if (route.operation === "denoise") {
      form.set("denoiseStrength", "0.3");
      form.set("sharpenStrength", "0");
    } else {
      form.set("outputWidth", String(width));
      form.set("outputHeight", String(height));
      form.set("cropToFill", "false");
      form.set("recoveryStrength", "0");
    }
  } else {
    endpoint = "https://api.claid.ai/v1/image/edit/upload";
    headers = { Authorization: `Bearer ${engine.key}` };
    form.set(
      "file",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      "original.png",
    );
    const operations: Record<string, unknown> = {
      resizing: { width, height, fit: "bounds" },
      background: { remove: false },
    };
    if (route.experience === "authentic")
      operations.restorations = { upscale: "smart_resize" };
    else {
      operations.adjustments = { hdr: 100 };
      operations.background = { remove: true, color: "#FFFFFF" };
    }
    form.set(
      "data",
      new Blob([JSON.stringify({ operations, output: { format: "png" } })], {
        type: "application/json",
      }),
      "request.json",
    );
  }
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers,
      body: form,
      signal,
      redirect: "error",
    });
  } catch {
    throw new ProviderFailure("provider_interrupted", true, false);
  }
  await check(response);
  let body = await json(response),
    requestId = identifier(response.headers.get("x-request-id"));
  let outputURL: unknown;
  if (engine.id === "topaz") {
    const id = identifier(body.process_id);
    if (!id) throw new ProviderFailure("invalid_output", true, false);
    requestId = id;
    usage.remote_job_id = id;
    // Record the accepted remote job before polling; restart must not resubmit it.
    await receipt?.(id, { ...usage });
    for (;;) {
      if (signal.aborted)
        throw new ProviderFailure("provider_interrupted", true, false);
      try {
        await wait(signal);
        response = await fetcher(
          `https://api.topazlabs.com/image/v1/status/${encodeURIComponent(id)}`,
          { headers, signal, redirect: "error" },
        );
      } catch {
        throw new ProviderFailure("provider_interrupted", true, false);
      }
      await check(response, true);
      body = await json(response);
      if (body.status === "Completed") break;
      if (["Failed", "Cancelled"].includes(body.status))
        throw new ProviderFailure("provider_unavailable", true, false);
      if (
        ![
          "Pending",
          "Queued",
          "Processing",
          "Running",
          "In Progress",
          "InProgress",
        ].includes(body.status)
      )
        throw new ProviderFailure("invalid_output", true, false);
    }
    try {
      response = await fetcher(
        `https://api.topazlabs.com/image/v1/download/${encodeURIComponent(id)}`,
        { headers, signal, redirect: "error" },
      );
    } catch {
      throw new ProviderFailure("provider_interrupted", true, false);
    }
    await check(response, true);
    body = await json(response);
    outputURL = body.download_url;
  } else {
    outputURL = body?.data?.output?.tmp_url;
    if (requestId) await receipt?.(requestId, { ...usage });
  }
  // Fetch only explicit provider storage prefixes. No credentials, source URL,
  // redirects, cookies or signed storage URLs are exposed to the browser/logs.
  const url = allowedOutputURL(outputURL, engine);
  try {
    response = await fetcher(url, {
      signal,
      redirect: "error",
      credentials: "omit",
    });
  } catch {
    throw new ProviderFailure("provider_interrupted", true, false);
  }
  await check(response, true);
  const bytes = await bounded(response, 32 * 1024 * 1024);
  let encoded: string;
  try {
    const image = sharp(bytes, {
        limitInputPixels: 25_000_000,
        animated: false,
        failOn: "warning",
      }),
      meta = await image.metadata();
    if (
      !["png", "webp", "jpeg"].includes(meta.format || "") ||
      (meta.pages ?? 1) > 1 ||
      meta.width !== width ||
      meta.height !== height
    )
      throw Error("shape");
    const normalized = await image.webp({ lossless: true }).toBuffer();
    if (normalized.length > 10 * 1024 * 1024) throw Error("size");
    encoded = normalized.toString("base64");
  } catch {
    throw new ProviderFailure("invalid_output", true, false);
  }
  usage.elapsed_ms = Date.now() - started;
  return {
    encoded,
    usage: null,
    requestId,
    engineUsage: usage,
    estimatedCost: route.estimate_micro_usd,
  };
}
