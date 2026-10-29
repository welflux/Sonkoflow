import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "../config.js";

export const authRequestHeader = "x-sonkoflow-auth-request";
export const authMutationPaths = new Set([
  "/auth/signup",
  "/auth/signin",
  "/auth/google",
  "/auth/recover",
  "/auth/confirm",
  "/auth/password",
  "/auth/signout",
]);
const lifetime = 600;
export function authRequestCookie(config: Config) {
  return config.NODE_ENV === "production"
    ? "__Host-sonkoflow_auth_request"
    : "sonkoflow_auth_request";
}
function signature(payload: string, config: Config) {
  return createHmac("sha256", config.RATE_LIMIT_KEY)
    .update(`sonkoflow-auth-request-v1\n${config.APP_ORIGIN}\n${payload}`)
    .digest();
}
export function validAuthRequestToken(
  token: unknown,
  config: Config,
  now = Date.now(),
) {
  if (
    typeof token !== "string" ||
    !/^\d{10}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)
  )
    return false;
  const [expires, nonce, mac] = token.split(".");
  const seconds = Math.floor(now / 1000);
  if (Number(expires) <= seconds || Number(expires) > seconds + lifetime + 60)
    return false;
  return timingSafeEqual(
    Buffer.from(mac, "hex"),
    signature(`${expires}.${nonce}`, config),
  );
}
export function issueAuthRequestToken(
  config: Config,
  existing?: unknown,
  now = Date.now(),
) {
  if (
    validAuthRequestToken(existing, config, now) &&
    Number((existing as string).split(".")[0]) > Math.floor(now / 1000) + 60
  )
    return existing as string;
  const payload = `${Math.floor(now / 1000) + lifetime}.${randomBytes(32).toString("hex")}`;
  return `${payload}.${signature(payload, config).toString("hex")}`;
}
export function validAuthRequestProof(
  header: unknown,
  cookie: unknown,
  config: Config,
) {
  if (
    !validAuthRequestToken(header, config) ||
    typeof cookie !== "string" ||
    typeof header !== "string"
  )
    return false;
  const a = Buffer.from(header),
    b = Buffer.from(cookie);
  return a.length === b.length && timingSafeEqual(a, b);
}
