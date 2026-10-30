import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { projectDirectoryRoutes } from "../../server/projects/routes.js";
const owner = "11111111-1111-4111-8111-111111111111",
  project = "22222222-2222-4222-8222-222222222222";
function fixture(failure = "") {
  const calls: any[] = [];
  const client: any = {
    from(table: string) {
      const c: any = { table, filters: [] };
      calls.push(c);
      const q: any = {
        select(value: string, options: any) {
          c.select = value;
          c.options = options;
          return q;
        },
        eq(key: string, value: any) {
          c.filters.push([key, value]);
          return q;
        },
        is(key: string, value: any) {
          c.filters.push([key, value]);
          return q;
        },
        order(key: string) {
          c.order = key;
          return q;
        },
        limit(value: number) {
          c.limit = value;
          return q;
        },
        then(resolve: any) {
          const data =
            table === "projects"
              ? [
                  {
                    id: project,
                    name: "Campaign",
                    audience: "ecommerce",
                    archived: false,
                    created_at: "2026-10-01T00:00:00Z",
                  },
                ]
              : table === "images"
                ? [{ id: "asset", created_at: "2026-10-02T00:00:00Z" }]
                : [
                    {
                      id: "operation",
                      mode: "product",
                      status: "completed",
                      created_at: "2026-10-02T00:00:00Z",
                      updated_at: "2026-10-03T00:00:00Z",
                      settings: {
                        brand_snapshot: {
                          profile_name: "Studio main",
                          profile_revision: 3,
                        },
                        private_data: "not returned",
                      },
                    },
                  ];
          return Promise.resolve({
            data,
            error: failure === table ? { code: "unavailable" } : null,
            count: table === "images" ? 142 : null,
          }).then(resolve);
        },
      };
      return q;
    },
  };
  const app = express();
  projectDirectoryRoutes(
    app,
    () => ({ userId: owner, client }) as any,
    async () => {},
  );
  app.use((e: any, _q: any, r: any, _n: any) =>
    r.status(e.status || 500).json({ error: { code: e.code } }),
  );
  return { app, calls };
}
test("Directory uses owner-scoped reads, exact ready asset counts and actual saved brand/activity; no object keys or settings escape", async () => {
  const f = fixture(),
    r = await request(f.app).get("/api/projects/directory");
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  const p = r.body.projects[0];
  assert.equal(p.asset_count, 142);
  assert.equal(p.last_activity_at, "2026-10-03T00:00:00Z");
  assert.equal(p.activity_kind, "operation");
  assert.deepEqual(p.last_operation.brand, {
    name: "Studio main",
    revision: 3,
  });
  assert.ok(!JSON.stringify(r.body).includes("private_data"));
  for (const c of f.calls) {
    assert.ok(
      c.filters.some(
        ([key, value]: any) => key === "user_id" && value === owner,
      ),
    );
    if (c.table !== "projects")
      assert.ok(
        c.filters.some(
          ([key, value]: any) =>
            key === "library_project_id" && value === project,
        ),
      );
  }
  const images = f.calls.find((c) => c.table === "images");
  assert.deepEqual(images.options, { count: "exact" });
  assert.ok(
    images.filters.some(
      ([key, value]: any) => key === "trashed_at" && value === null,
    ),
  );
  assert.equal(images.limit, 1);
});
test("Metadata failure preserves accessible project records without inventing zero counts", async () => {
  const f = fixture("images"),
    r = await request(f.app).get("/api/projects/directory");
  assert.equal(r.status, 200);
  assert.equal(r.body.projects[0].metadata_available, false);
  assert.equal(r.body.projects[0].asset_count, null);
});
test("Project query failure is an explicit service error rather than an empty directory", async () => {
  const f = fixture("projects"),
    r = await request(f.app).get("/api/projects/directory");
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "project_directory_unavailable");
});

test("Directory metadata is protected by the existing account authentication boundary", async () => {
  const { createApp } = await import("../../server/app.js");
  const app = createApp({
    NODE_ENV: "production",
    TRUST_PROXY_HOPS: 0,
    PORT: 3000,
    APP_ORIGIN: "https://sonkoflow.com",
    SUPABASE_URL: "https://unconnected.example.invalid",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key-not-connected",
    SUPABASE_SECRET_KEY: "test-secret-key-not-connected",
    SESSION_ENCRYPTION_KEY: "a".repeat(64),
    RATE_LIMIT_KEY: "b".repeat(64),
  });
  const r = await request(app).get("/api/projects/directory");
  assert.equal(r.status, 401);
  assert.equal(r.body.projects, undefined);
});
