import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import request from "supertest";
import { GoogleAuth } from "../../server/auth/google.js";
import { seal, unseal } from "../../server/security.js";
import { createApp } from "../../server/app.js";
import type { Config } from "../../server/config.js";
const config: Config = {
  NODE_ENV: "test",
  TRUST_PROXY_HOPS: 0,
  PORT: 3000,
  APP_ORIGIN: "https://sonkoflow.com",
  SUPABASE_URL: "https://test-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key-not-connected",
  SUPABASE_SECRET_KEY: "test-server-key-not-connected",
  SESSION_ENCRYPTION_KEY: "a".repeat(64),
  RATE_LIMIT_KEY: "b".repeat(64),
};
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.com",
  email_confirmed_at: "2026-10-28T00:00:00Z",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "google" },
  user_metadata: {},
  created_at: "2026-10-28T00:00:00Z",
};
test("Google availability requires operator opt-in AND provider settings; failures remain hidden", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({ external: { google: true } });
  }) as typeof fetch;
  assert.equal(await new GoogleAuth(config, fetcher, {}).available(), false);
  assert.equal(calls, 0);
  const enabled = new GoogleAuth(config, fetcher, { AUTH_GOOGLE_ENABLED: "1" });
  assert.equal(await enabled.available(), true);
  assert.equal(await enabled.available(), true);
  assert.equal(calls, 1);
  assert.equal(
    await new GoogleAuth(
      config,
      (async () =>
        Response.json({ external: { google: false } })) as typeof fetch,
      { AUTH_GOOGLE_ENABLED: "1" },
    ).available(),
    false,
  );
  assert.equal(
    await new GoogleAuth(
      config,
      (async () => {
        throw Error("provider offline");
      }) as typeof fetch,
      { AUTH_GOOGLE_ENABLED: "1" },
    ).available(),
    false,
  );
});
test("Actual Supabase PKCE initiation encrypts verifier/state and fixes the exact callback origin", async () => {
  const auth = new GoogleAuth(
    config,
    (async () => Response.json({ external: { google: true } })) as typeof fetch,
    { AUTH_GOOGLE_ENABLED: "1" },
  );
  const flow = await auth.start(),
    url = new URL(flow.url),
    data = unseal(flow.cookie, config.SESSION_ENCRYPTION_KEY);
  assert.equal(url.origin, config.SUPABASE_URL);
  assert.equal(url.pathname, "/auth/v1/authorize");
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  assert.equal(
    url.searchParams.get("redirect_to"),
    `${config.APP_ORIGIN}/api/auth/google/callback?state=${data.state}`,
  );
  assert(flow.cookie.length < 3800);
  assert(!flow.cookie.includes(data.state));
  assert(!JSON.stringify(data).includes(config.SUPABASE_SECRET_KEY));
});
test("Actual SDK exchange uses the matching verifier then independently checks the provider user", async () => {
  let observed: any,
    identityChecks = 0;
  const fetcher = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/settings"))
      return Response.json({ external: { google: true } });
    if (url.includes("/token?grant_type=pkce")) {
      observed = JSON.parse(String(init?.body));
      return Response.json({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
    }
    if (url.endsWith("/user")) {
      identityChecks++;
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer test-access-token",
      );
      return Response.json(user);
    }
    throw Error("Unexpected provider route");
  }) as typeof fetch;
  const auth = new GoogleAuth(config, fetcher, { AUTH_GOOGLE_ENABLED: "1" }),
    flow = await auth.start(),
    data = unseal(flow.cookie, config.SESSION_ENCRYPTION_KEY),
    url = new URL(flow.url),
    session = await auth.finish(
      flow.cookie,
      data.state,
      "auth-code-from-provider",
    );
  assert.equal(session.user.id, user.id);
  assert.equal(identityChecks, 1);
  assert.equal(observed.auth_code, "auth-code-from-provider");
  assert.equal(
    createHash("sha256").update(observed.code_verifier).digest("base64url"),
    url.searchParams.get("code_challenge"),
  );
});
test("Callback rejects forged, missing, tampered, expired or mismatched state before network exchange", async () => {
  let calls = 0;
  const auth = new GoogleAuth(
      config,
      (async () => {
        calls++;
        return Response.json({ external: { google: true } });
      }) as typeof fetch,
      { AUTH_GOOGLE_ENABLED: "1" },
    ),
    flow = await auth.start(),
    data = unseal(flow.cookie, config.SESSION_ENCRYPTION_KEY);
  for (const [cookie, state, code] of [
    [undefined, data.state, "code-valid"],
    [flow.cookie, "f".repeat(64), "code-valid"],
    [flow.cookie + "bad", data.state, "code-valid"],
    [flow.cookie, data.state, ""],
    [
      seal(
        { ...data, created: Date.now() - 610000 },
        config.SESSION_ENCRYPTION_KEY,
      ),
      data.state,
      "code-valid",
    ],
  ])
    await assert.rejects(
      auth.finish(cookie, state, code),
      /google_callback_invalid/,
    );
  assert.equal(calls, 1);
});
test("Public auth capabilities are safe unconfigured; OAuth initiation retains origin protection", async () => {
  const empty = createApp(null);
  const caps = await request(empty).get("/api/public/auth");
  assert.equal(caps.status, 200);
  assert.deepEqual(caps.body, { google: false });
  assert.equal(caps.headers["cache-control"], "no-store");
  const app = createApp(config);
  assert.equal(
    (
      await request(app)
        .post("/api/auth/google")
        .set("Origin", "https://attacker.invalid")
        .send({})
    ).status,
    403,
  );
  const callback = await request(app).get(
    "/api/auth/google/callback?state=invalid&code=invalid",
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.location, "/account/signin?auth_error=google");
  assert(
    callback.headers["set-cookie"].some((c: string) =>
      c.startsWith("sonkoflow_oauth=;"),
    ),
  );
});

test("Provider rejection and a mismatched verified identity cannot create an application session", async () => {
  for (const rejected of [true, false]) {
    const auth = new GoogleAuth(
      config,
      (async (input) => {
        const url = String(input);
        if (url.endsWith("/settings"))
          return Response.json({ external: { google: true } });
        if (url.includes("/token?grant_type=pkce"))
          return rejected
            ? Response.json(
                {
                  error: "invalid_grant",
                  error_description: "Expired authorization code",
                },
                { status: 400 },
              )
            : Response.json({
                access_token: "test-token",
                refresh_token: "test-refresh",
                expires_in: 3600,
                token_type: "bearer",
                user,
              });
        if (url.endsWith("/user"))
          return Response.json({
            ...user,
            id: "22222222-2222-4222-8222-222222222222",
          });
        throw Error("Unexpected route");
      }) as typeof fetch,
      { AUTH_GOOGLE_ENABLED: "1" },
    );
    const flow = await auth.start(),
      data = unseal(flow.cookie, config.SESSION_ENCRYPTION_KEY);
    await assert.rejects(
      auth.finish(flow.cookie, data.state, "provider-code-valid"),
      /google_callback_invalid/,
    );
  }
});
