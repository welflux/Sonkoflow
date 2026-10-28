import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { libraryRoutes } from "../../server/library/routes.js";
import { hash } from "../../server/security.js";
const id = "11111111-1111-4111-8111-111111111111",
  owner = "22222222-2222-4222-8222-222222222222";
async function fixture({ visible = true, storageFailure = false } = {}) {
  const bytes = await sharp({
    create: { width: 1024, height: 768, channels: 3, background: "#abc" },
  })
    .webp()
    .toBuffer();
  let downloads = 0;
  const calls: any[] = [];
  const client: any = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({
          data: visible
            ? {
                id,
                object_key: `${owner}/${id}.webp`,
                checksum: hash(bytes),
                status: "ready",
              }
            : null,
          error: null,
        }),
      };
    },
  };
  const admin: any = {
    rpc: async (name: string, p: any) => {
      calls.push({ name, p });
      return { data: 1, error: null };
    },
    storage: {
      from: () => ({
        download: async () => {
          downloads++;
          return {
            data: storageFailure ? null : new Blob([bytes]),
            error: storageFailure ? {} : null,
          };
        },
      }),
    },
  };
  const app = express();
  app.use(express.json());
  libraryRoutes(
    app,
    { admin } as any,
    () => ({ userId: owner, client }) as any,
    async () => {},
  );
  app.use((e: any, _q: any, r: any, _n: any) =>
    r
      .status(e.status ?? 400)
      .json({ error: { code: e.code ?? "invalid_input" } }),
  );
  return { app, calls, downloads: () => downloads };
}
test("Library thumbnails check ownership before storage and return bounded WebP without exposing object URLs", async () => {
  const f = await fixture();
  const r = await request(f.app)
    .get(`/api/library/${id}/thumbnail`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (b) => chunks.push(b));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(r.status, 200);
  assert.match(r.headers["cache-control"], /no-store/);
  const metadata = await sharp(r.body).metadata();
  assert.equal(metadata.width, 480);
  assert.equal(metadata.height, 360);
  const denied = await fixture({ visible: false });
  assert.equal(
    (await request(denied.app).get(`/api/library/${id}/thumbnail`)).status,
    404,
  );
  assert.equal(denied.downloads(), 0);
});
test("Thumbnail storage failure produces an honest error, not an empty successful image", async () => {
  const f = await fixture({ storageFailure: true });
  const r = await request(f.app).get(`/api/library/${id}/thumbnail`);
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "thumbnail_storage");
});
test("Gallery queries and bulk actions always use session ownership and reject injected owner or missing rename values", async () => {
  const f = await fixture();
  assert.equal(
    (await request(f.app).get("/api/library?user_id=foreign")).status,
    400,
  );
  const query = await request(f.app).get("/api/library?search=linen");
  assert.equal(query.status, 200);
  assert.equal(f.calls[0].p.owner, owner);
  assert.equal(
    (
      await request(f.app)
        .post("/api/library/actions")
        .send({ ids: [id], action: "rename" })
    ).status,
    400,
  );
  await request(f.app)
    .post("/api/library/actions")
    .send({ ids: [id], action: "move", value: null });
  assert.equal(f.calls.at(-1).p.owner, owner);
});
