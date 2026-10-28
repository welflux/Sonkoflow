import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchInput,
  batchConfig,
  batchProgress,
} from "../../server/batches/service.js";
import { imageZip } from "../../server/packs/zip.js";
const id = "11111111-1111-4111-8111-111111111111";
test("Batch inputs reject repeated sources, client-owned policy overrides and unsupported modes", () => {
  const p = {
    name: "Products",
    project_id: id,
    image_ids: [id],
    outputs: [{ type: "listing", quality: "low" }],
  };
  assert(batchInput.parse(p));
  assert.throws(() => batchInput.parse({ ...p, image_ids: [id, id] }));
  assert.throws(() => batchInput.parse({ ...p, max_images: 1000 }));
  assert.throws(() => batchInput.parse({ ...p, mode: "portrait" }));
  assert.equal(batchConfig({}).AI_BATCH_MAX_IMAGES, 5);
  assert.equal(
    batchConfig({ AI_BATCH_MAX_IMAGES: "100" }).AI_BATCH_MAX_IMAGES,
    100,
  );
  assert.throws(() => batchConfig({ AI_BATCH_MAX_IMAGES: "101" }));
});
test("Progress derives only from persisted per-output states, and partial/empty batches never claim full completion", () => {
  const item = (status: string) => ({
    progress: {
      total: 1,
      completed: status === "completed" ? 1 : 0,
      pending: ["queued", "running"].includes(status) ? 1 : 0,
      reviewing: 0,
    },
    outputs: [{ current: { status } }],
  });
  assert.equal(batchProgress([item("queued")]).status, "queued");
  assert.equal(batchProgress([item("running")]).counts.processing, 1);
  assert.equal(
    batchProgress([item("completed"), item("failed")]).status,
    "partially_completed",
  );
  assert.equal(batchProgress([item("cancelled")]).status, "cancelled");
  assert.equal(batchProgress([]).status, "incomplete");
});
test("Batch ZIP permits a bounded multi-pack selection while standalone pack defaults remain bounded", () => {
  const files = Array.from({ length: 20 }, (_, i) => ({
    name: `image-${i}.webp`,
    bytes: Buffer.from("test"),
  }));
  assert.throws(() => imageZip(files));
  assert.equal(imageZip(files, 100).readUInt32LE(0), 0x04034b50);
  assert.throws(() =>
    imageZip(
      Array.from({ length: 101 }, (_, i) => ({
        name: `${i}.webp`,
        bytes: Buffer.from("test"),
      })),
      100,
    ),
  );
});
