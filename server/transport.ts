import {
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  FormData as UndiciFormData,
} from "undici";
// Node's default fetch does not consistently honor HTTPS_PROXY across supported
// versions. Use the inherited proxy and NO_PROXY settings; keep CA verification.
const proxyConfigured = !!(
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.http_proxy
);
const dispatcher = proxyConfigured ? new EnvHttpProxyAgent() : undefined;
export const timedProviderFetch =
  (timeoutMs: number): typeof fetch =>
  (input, init) => {
    const options: RequestInit & { dispatcher?: EnvHttpProxyAgent } = {
      ...init,
      dispatcher,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    };
    // Keep fetch and its dispatcher on the same Undici version.
    return (undiciFetch as unknown as typeof fetch)(input, options);
  };
export const providerFetch = timedProviderFetch(20_000);
export async function closeProviderTransport() {
  await dispatcher?.close();
}

// Multipart form brands must also match Undici's fetch implementation. Native
// Node FormData from another bundled Undici version can be serialized as text.
export function providerFormData(): FormData {
  return new UndiciFormData() as unknown as FormData;
}
