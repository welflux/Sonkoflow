import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/app.js";
import type { Config } from "../../server/config.js";
const config: Config = {
  NODE_ENV: "test",
  TRUST_PROXY_HOPS: 0,
  PORT: 3000,
  APP_ORIGIN: "http://localhost:5173",
  SUPABASE_URL: "https://unconnected.example.invalid",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key-not-connected",
  SUPABASE_SECRET_KEY: "test-secret-key-not-connected",
  SESSION_ENCRYPTION_KEY: "a".repeat(64),
  RATE_LIMIT_KEY: "b".repeat(64),
};
test("unconfigured account services fail closed without fabricated success", async () => {
  const app = createApp(null);
  for (const route of [
    "/api/session",
    "/api/projects",
    "/api/images",
    "/api/jobs?project_id=11111111-1111-4111-8111-111111111111",
    "/api/processing/capabilities",
  ]) {
    const response = await request(app).get(route);
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "not_configured");
    assert.equal(response.headers["cache-control"], "no-store");
  }
  const result = await request(app)
    .post("/api/auth/signup")
    .send({ email: "test@example.com", password: "long-password" });
  assert.equal(result.status, 503);
});
test("protected APIs reject missing sessions before accessing external services", async () => {
  const app = createApp(config);
  for (const route of [
    "/api/session",
    "/api/projects",
    "/api/images",
    "/api/jobs?project_id=11111111-1111-4111-8111-111111111111",
    "/api/processing/capabilities",
  ]) {
    const result = await request(app).get(route);
    assert.equal(result.status, 401);
  }
  const mutation = await request(app)
    .post("/api/projects")
    .set("Origin", config.APP_ORIGIN)
    .send({ name: "Unauthorized", audience: "individual" });
  assert.equal(mutation.status, 401);
  for (const action of ["decision", "quality-retry"]) {
    const denied = await request(app)
      .post(`/api/jobs/11111111-1111-4111-8111-111111111111/${action}`)
      .set("Origin", config.APP_ORIGIN)
      .send({});
    assert.equal(denied.status, 401);
    assert.equal(
      (
        await request(app)
          .post(`/api/jobs/11111111-1111-4111-8111-111111111111/${action}`)
          .set("Origin", "https://attacker.example")
          .send({})
      ).status,
      403,
    );
  }
});
test("mutations reject missing/foreign origins, including login CSRF", async () => {
  const app = createApp(config);
  for (const origin of ["", "https://attacker.example"]) {
    let req = request(app).post("/api/auth/signin");
    if (origin) req = req.set("Origin", origin);
    const result = await req.send({
      email: "test@example.com",
      password: "password",
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, "invalid_origin");
  }
});
test("server pages protect workspace routes and keep approved marketing reachable", async () => {
  const app = createApp(null);
  assert.equal((await request(app).get("/")).status, 200);
  const protectedPage = await request(app).get("/app");
  assert.equal(protectedPage.status, 302);
  assert.equal(protectedPage.headers.location, "/account");
  assert.equal((await request(app).get("/app.html")).status, 302);
  const signin = await request(app).get("/account/signin");
  assert.equal(signin.status, 200);
  assert(!signin.text.includes("SUPABASE_SECRET_KEY"));
  assert(
    signin.headers["content-security-policy"].includes(
      "frame-ancestors 'none'",
    ),
  );
  assert.equal(signin.headers["referrer-policy"], "no-referrer");
});
test("unexpected routes and invalid JSON return bounded non-sensitive errors", async () => {
  const app = createApp(config);
  const bad = await request(app)
    .post("/api/auth/signin")
    .set("Origin", config.APP_ORIGIN)
    .set("Content-Type", "application/json")
    .send("{");
  assert.equal(bad.status, 400);
  assert(!JSON.stringify(bad.body).includes("stack"));
  assert(bad.body.error.requestId);
  assert.equal((await request(app).get("/missing-page")).status, 404);
});
