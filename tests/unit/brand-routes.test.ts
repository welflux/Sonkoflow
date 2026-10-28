import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { brandRoutes } from "../../server/brand/routes.js";
import { brandSettings } from "../../server/brand/contracts.js";
const owner = randomUUID(),
  id = randomUUID();
function fixture({ storageFailure = false, foreign = false } = {}) {
  const rows: any[] = [];
  const calls: any[] = [],
    objects = new Map<string, Buffer>();
  const identity: any = {
    userId: owner,
    client: {
      from() {
        let filters: any = {};
        const q: any = {
          select: () => q,
          eq: (k: string, v: any) => {
            filters[k] = v;
            return q;
          },
          order: () => q,
          maybeSingle: () =>
            Promise.resolve({
              data: foreign
                ? null
                : (rows.find((r) =>
                    Object.entries(filters).every(([k, v]) => r[k] === v),
                  ) ?? null),
              error: null,
            }),
          then: (resolve: any) =>
            resolve({
              data: foreign
                ? []
                : rows.filter((r) =>
                    Object.entries(filters).every(([k, v]) => r[k] === v),
                  ),
              error: null,
            }),
        };
        return q;
      },
    },
  };
  const admin: any = {
    rpc: async (name: string, p: any) => {
      calls.push({ name, p });
      if (name === "brand_schema_version")
        return { data: 2026102804, error: null };
      if (name === "reserve_brand_asset") {
        let a = rows.find((r) => r.id === p.target);
        if (!a) {
          a = {
            ...p.p,
            id: p.target,
            user_id: p.owner,
            status: "pending",
            object_key: `${p.owner}/brand-${p.target}.webp`,
          };
          rows.push(a);
        }
        return { data: a, error: null };
      }
      if (name === "mutate_brand")
        return { data: { id: p.target }, error: null };
    },
    from() {
      let filters: any = {},
        patch: any = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          filters[k] = v;
          return q;
        },
        update: (v: any) => {
          patch = v;
          return q;
        },
        maybeSingle: async () => ({
          data:
            rows.find((r) =>
              Object.entries(filters).every(([k, v]) => r[k] === v),
            ) ?? null,
          error: null,
        }),
        single: async () => {
          const row = rows.find((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v),
          );
          if (row) Object.assign(row, patch);
          return {
            data: row ?? null,
            error: row ? null : { message: "missing" },
          };
        },
        then: (resolve: any) => {
          for (const row of rows.filter((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v),
          ))
            Object.assign(row, patch);
          resolve({ data: null, error: null });
        },
      };
      return q;
    },
    storage: {
      from: () => ({
        upload: async (key: string, b: Buffer) => {
          if (!storageFailure) objects.set(key, b);
          return { error: storageFailure ? {} : null };
        },
        download: async (key: string) => ({
          data: objects.has(key) ? new Blob([objects.get(key)!]) : null,
          error: objects.has(key) ? null : {},
        }),
      }),
    },
  };
  const app = express();
  app.use(express.json());
  brandRoutes(
    app,
    { admin } as any,
    () => identity,
    async () => {},
  );
  app.use((e: any, _q: any, r: any, _n: any) =>
    r
      .status(e.status ?? 400)
      .json({ error: { code: e.code ?? "invalid_input" } }),
  );
  return { app, rows, calls, objects };
}
test("Brand mutation routes use the authenticated owner and reject unvalidated profile fields", async () => {
  const f = fixture();
  const r = await request(f.app)
    .post("/api/brands")
    .send({
      id,
      data: { name: "Brand", settings: brandSettings.parse({}) },
      user_id: randomUUID(),
    });
  assert.equal(r.status, 400);
  assert(!f.calls.some((c) => c.name === "mutate_brand"));
  const good = await request(f.app)
    .post("/api/brands")
    .send({ id, data: { name: "Brand", settings: brandSettings.parse({}) } });
  assert.equal(good.status, 200);
  assert.equal(f.calls.find((c) => c.name === "mutate_brand").p.owner, owner);
});
test("Real multipart asset upload is validated, stored privately, read-back verified and idempotent", async () => {
  const f = fixture(),
    bytes = await sharp({
      create: { width: 64, height: 48, channels: 4, background: "#d00" },
    })
      .png()
      .toBuffer();
  const upload = () =>
    request(f.app)
      .post("/api/brands/assets")
      .field("id", id)
      .field("name", "Owner logo")
      .field("kind", "logo")
      .attach("asset", bytes, {
        filename: "logo.png",
        contentType: "image/png",
      });
  assert.equal((await upload()).status, 201);
  assert.equal(f.rows[0].status, "ready");
  assert.equal(f.objects.size, 1);
  assert.equal((await upload()).status, 200);
  assert.equal(f.rows.length, 1);
  const content = await request(f.app).get(`/api/brands/assets/${id}/content`);
  assert.equal(content.status, 200);
  assert.match(content.headers["content-type"], /image\/webp/);
  assert.equal(content.headers["cache-control"], "no-store");
});
test("Storage failure never marks a brand asset ready, returns no object URL and cannot publish a false success", async () => {
  const f = fixture({ storageFailure: true }),
    bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
  const r = await request(f.app)
    .post("/api/brands/assets")
    .field("id", id)
    .field("name", "Logo")
    .field("kind", "logo")
    .attach("asset", bytes, { filename: "logo.png", contentType: "image/png" });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "brand_storage");
  assert.equal(f.rows[0].status, "pending");
  assert.equal(f.objects.size, 0);
});
test("Unowned assets are denied before private storage access or deletion", async () => {
  const f = fixture({ foreign: true });
  const content = await request(f.app).get(`/api/brands/assets/${id}/content`);
  assert.equal(content.status, 404);
  const remove = await request(f.app).delete(`/api/brands/assets/${id}`);
  assert.equal(remove.status, 404);
  assert.equal(f.objects.size, 0);
});
