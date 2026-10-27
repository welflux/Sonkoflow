import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
// Node's default fetch does not consistently honor HTTPS_PROXY across supported
// versions. Use the inherited proxy and NO_PROXY settings; keep CA verification.
const proxyConfigured = !!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy);
const dispatcher = proxyConfigured ? new EnvHttpProxyAgent() : undefined;
export const providerFetch: typeof fetch = (input, init) => {
  const options: RequestInit & { dispatcher?: EnvHttpProxyAgent } = {
    ...init,
    dispatcher,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  };
  // Keep fetch and its dispatcher on the same Undici version.
  return (undiciFetch as unknown as typeof fetch)(input, options);
};
export async function closeProviderTransport() { await dispatcher?.close(); }
