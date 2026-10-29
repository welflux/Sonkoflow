import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/app.js";
import type { Config } from "../../server/config.js";
import {
  issueAuthRequestToken,
  validAuthRequestToken,
  validAuthRequestProof,
} from "../../server/auth/request-proof.js";
const config: Config = {
  NODE_ENV: "production",
  TRUST_PROXY_HOPS: 0,
  PORT: 3000,
  APP_ORIGIN: "https://sonkoflow.com",
  SUPABASE_URL: "https://unconnected.example.invalid",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key-not-connected",
  SUPABASE_SECRET_KEY: "test-secret-key-not-connected",
  SESSION_ENCRYPTION_KEY: "a".repeat(64),
  RATE_LIMIT_KEY: "b".repeat(64),
};
test("auth request proofs expire, bind to this origin/key and require the exact signed cookie/header pair", () => {
  const now = 1800000000000,
    token = issueAuthRequestToken(config, undefined, now);
  assert(validAuthRequestToken(token, config, now));
  assert(validAuthRequestToken(token, config, now - 2000));
  assert.equal(issueAuthRequestToken(config, token, now), token);
  assert.notEqual(issueAuthRequestToken(config, token, now + 570000), token);
  assert(!validAuthRequestToken(token, config, now + 600000));
  assert(
    !validAuthRequestToken(
      token,
      { ...config, APP_ORIGIN: "https://attacker.example" },
      now,
    ),
  );
  assert(
    !validAuthRequestToken(
      token,
      { ...config, RATE_LIMIT_KEY: "c".repeat(64) },
      now,
    ),
  );
  assert(
    !validAuthRequestToken(
      token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"),
      config,
      now,
    ),
  );
  const actual = issueAuthRequestToken(config);
  assert(validAuthRequestProof(actual, actual, config));
  assert(!validAuthRequestProof(actual, issueAuthRequestToken(config), config));
  for (const invalid of [undefined, null, "null", "", actual + "x"])
    assert(!validAuthRequestProof(invalid, actual, config));
});
test("public verification uses a non-cacheable secure HttpOnly host cookie and rejects cross-site reads", async () => {
  const app = createApp(config);
  const r = await request(app)
    .get("/api/public/auth-request")
    .set("Sec-Fetch-Site", "same-origin");
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  const cookie = r.headers["set-cookie"][0];
  assert(cookie.startsWith("__Host-sonkoflow_auth_request="));
  for (const value of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
    assert(cookie.includes(value));
  assert(!cookie.includes("Domain="));
  assert(validAuthRequestToken(r.body.token, config));
  for (const site of ["cross-site", "same-site"])
    assert.equal(
      (
        await request(app)
          .get("/api/public/auth-request")
          .set("Sec-Fetch-Site", site)
      ).status,
      403,
    );
  const repeat = await request(app)
    .get("/api/public/auth-request")
    .set("Cookie", cookie.split(";")[0]);
  assert.equal(repeat.body.token, r.body.token);
});
test("missing/opaque auth origins require signed first-party proof; foreign and non-auth mutations remain rejected", async () => {
  const app = createApp(config),
    proof = await request(app).get("/api/public/auth-request");
  const cookie = proof.headers["set-cookie"][0].split(";")[0],
    token = proof.body.token;
  for (const origin of [undefined, "null"]) {
    let denied = request(app).post("/api/auth/signout");
    if (origin) denied = denied.set("Origin", origin);
    assert.equal((await denied.send({})).status, 403);
    let accepted = request(app)
      .post("/api/auth/signout")
      .set("Cookie", cookie)
      .set("X-Sonkoflow-Auth-Request", token)
      .set("Sec-Fetch-Site", "same-origin");
    if (origin) accepted = accepted.set("Origin", origin);
    // The origin gate passes; ordinary authentication still rejects an absent login session.
    const result = await accepted.send({});
    assert.equal(result.status, 401);
    assert.notEqual(result.body.error.code, "invalid_origin");
  }
  for (const [origin, site, route] of [
    ["https://attacker.example", "same-origin", "/api/auth/signout"],
    ["null", "cross-site", "/api/auth/signout"],
    ["null", "same-origin", "/api/projects"],
  ]) {
    const result = await request(app)
      .post(route)
      .set("Origin", origin)
      .set("Sec-Fetch-Site", site)
      .set("Cookie", cookie)
      .set("X-Sonkoflow-Auth-Request", token)
      .send({});
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, "invalid_origin");
  }
  for (const headers of [
    { header: token, cookie: "" },
    { header: issueAuthRequestToken(config), cookie },
    { header: "forged", cookie },
  ]) {
    const result = await request(app)
      .post("/api/auth/signout")
      .set("Origin", "null")
      .set("Cookie", headers.cookie)
      .set("X-Sonkoflow-Auth-Request", headers.header)
      .send({});
    assert.equal(result.status, 403);
  }
  assert.equal(
    (
      await request(app)
        .post("/api/auth/signout")
        .set("Origin", config.APP_ORIGIN)
        .send({})
    ).status,
    401,
  );
});
