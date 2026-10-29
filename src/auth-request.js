const protectedPaths = new Set([
  "/api/auth/signup",
  "/api/auth/signin",
  "/api/auth/google",
  "/api/auth/recover",
  "/api/auth/confirm",
  "/api/auth/password",
  "/api/auth/signout",
]);
// Retry only an explicit origin rejection, which occurs before an auth handler runs.
// Missing/opaque browser origins use a short-lived, signed HttpOnly-cookie proof.
export async function accountFetch(path, options) {
  if (options.method !== "POST" || !protectedPaths.has(path))
    return fetch(path, options);
  const safeOptions = {
    ...options,
    credentials: "same-origin",
    mode: "same-origin",
    cache: "no-store",
    redirect: "error",
  };
  const response = await fetch(path, safeOptions);
  if (response.status !== 403) return response;
  const error = await response
    .clone()
    .json()
    .catch(() => null);
  if (error?.error?.code !== "invalid_origin") return response;
  const verification = await fetch("/api/public/auth-request", {
    credentials: "same-origin",
    mode: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (!verification.ok) return response;
  const data = await verification.json().catch(() => null);
  if (
    typeof data?.token !== "string" ||
    !/^\d{10}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(data.token)
  )
    return response;
  const headers = new Headers(options.headers);
  headers.set("X-Sonkoflow-Auth-Request", data.token);
  return fetch(path, { ...safeOptions, headers });
}
