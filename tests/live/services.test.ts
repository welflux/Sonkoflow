import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import request from "supertest";
import { loadConfig } from "../../server/config.js";
import { createApp } from "../../server/app.js";
import { services } from "../../server/services.js";
// Opt-in: creates and deletes isolated real test accounts/objects in the selected
// Supabase project. Run against a development project, not customer data.
test(
  "real Supabase auth, recovery, cookie revocation, RLS, storage roundtrip, and deletion",
  { skip: process.env.RUN_LIVE_TESTS !== "1" },
  async () => {
    const config = loadConfig();
    assert(config);
    config.NODE_ENV = "test";
    const app = createApp(config);
    const svc = services(config);
    const ids: string[] = [];
    const agents = [request.agent(app), request.agent(app)];
    const users = [
      `sonkoflow-${randomUUID()}@example.invalid`,
      `sonkoflow-${randomUUID()}@example.invalid`,
    ];
    const password = `A!${randomUUID()}long`;
    try {
      for (let i = 0; i < 2; i++) {
        const created = await svc.admin.auth.admin.createUser({
          email: users[i],
          password,
          email_confirm: true,
        });
        assert.ifError(created.error);
        ids.push(created.data.user!.id);
        const signin = await agents[i]
          .post("/api/auth/signin")
          .set("Origin", config.APP_ORIGIN)
          .send({ email: users[i], password });
        assert.equal(signin.status, 200, JSON.stringify(signin.body));
        assert(
          signin.headers["set-cookie"].some((c: string) =>
            c.includes("HttpOnly"),
          ),
        );
      }
      const project = await agents[0]
        .post("/api/projects")
        .set("Origin", config.APP_ORIGIN)
        .send({ name: "Live integration test", audience: "ecommerce" });
      assert.equal(project.status, 201);
      const pid = project.body.project.id;
      const isolation = await agents[1].get("/api/projects");
      assert.equal(isolation.status, 200);
      assert(
        !isolation.body.projects.some((p: { id: string }) => p.id === pid),
      );
      const bytes = await sharp({
        create: { width: 128, height: 128, channels: 3, background: "#0EA5E9" },
      })
        .png()
        .toBuffer();
      const imageId = randomUUID();
      const uploaded = await agents[0]
        .post("/api/images")
        .set("Origin", config.APP_ORIGIN)
        .field("id", imageId)
        .field("project_id", pid)
        .attach("image", bytes, "test.png");
      assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
      const retry = await agents[0]
        .post("/api/images")
        .set("Origin", config.APP_ORIGIN)
        .field("id", imageId)
        .field("project_id", pid)
        .attach("image", bytes, "test.png");
      assert.equal(retry.status, 200);
      assert.equal(
        (await agents[1].get(`/api/images/${imageId}/content`)).status,
        404,
      );
      assert.equal(
        (
          await agents[1]
            .delete(`/api/images/${imageId}`)
            .set("Origin", config.APP_ORIGIN)
        ).status,
        404,
      );
      const downloaded = await agents[0].get(`/api/images/${imageId}/content`);
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.headers["content-type"], "image/webp");
      assert.equal(
        (
          await agents[0]
            .delete(`/api/images/${imageId}`)
            .set("Origin", config.APP_ORIGIN)
        ).status,
        200,
      );
      assert.equal(
        (await agents[0].get(`/api/images/${imageId}/content`)).status,
        404,
      );
      assert.equal(
        (
          await agents[0]
            .delete(`/api/projects/${pid}`)
            .set("Origin", config.APP_ORIGIN)
        ).status,
        200,
      );
      // Exercise real recovery token verification without sending an email.
      // This verifies the backend flow, not SMTP delivery or a real mailbox.
      const recoveryLink = await svc.admin.auth.admin.generateLink({
        type: "recovery", email: users[1],
      });
      assert.ifError(recoveryLink.error);
      const recoveryHash = recoveryLink.data.properties?.hashed_token;
      assert(recoveryHash, "Provider must return a recovery token hash");
      const recoveryAgent = request.agent(app);
      const confirmed = await recoveryAgent.post("/api/auth/confirm")
        .set("Origin", config.APP_ORIGIN)
        .send({ token_hash: recoveryHash, type: "recovery" });
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.recovery, true);
      assert.equal((await recoveryAgent.get("/api/projects")).status, 403);
      const reused = await request(app).post("/api/auth/confirm")
        .set("Origin", config.APP_ORIGIN)
        .send({ token_hash: recoveryHash, type: "recovery" });
      assert.equal(reused.status, 400);
      const nextPassword = `B!${randomUUID()}reset`;
      const reset = await recoveryAgent.post("/api/auth/password")
        .set("Origin", config.APP_ORIGIN).send({ password: nextPassword });
      assert.equal(reset.status, 200, JSON.stringify(reset.body));
      assert.equal((await agents[1].get("/api/session")).status, 401);
      assert.equal((await recoveryAgent.get("/api/session")).status, 401);
      const oldLogin = await request(app).post("/api/auth/signin")
        .set("Origin", config.APP_ORIGIN).send({ email: users[1], password });
      assert.equal(oldLogin.status, 401);
      const newLogin = await agents[1].post("/api/auth/signin")
        .set("Origin", config.APP_ORIGIN)
        .send({ email: users[1], password: nextPassword });
      assert.equal(newLogin.status, 200, JSON.stringify(newLogin.body));
      const signed = await agents[0].get("/api/session");
      assert.equal(signed.status, 200);
      assert.equal(
        (
          await agents[0]
            .post("/api/auth/signout")
            .set("Origin", config.APP_ORIGIN)
        ).status,
        200,
      );
      assert.equal((await agents[0].get("/api/session")).status, 401);
    } finally {
      for (const id of ids) {
        const objects = await svc.admin
          .from("images")
          .select("object_key")
          .eq("user_id", id);
        if (objects.data?.length)
          await svc.admin.storage
            .from("photos")
            .remove(objects.data.map((i) => i.object_key));
        await svc.admin.from("usage_events").delete().eq("user_id", id);
        await svc.admin.from("processing_jobs").delete().eq("user_id", id);
        await svc.admin.from("images").delete().eq("user_id", id);
        await svc.admin.from("projects").delete().eq("user_id", id);
        const deleted = await svc.admin.auth.admin.deleteUser(id);
        assert.ifError(deleted.error);
      }
    }
  },
);
