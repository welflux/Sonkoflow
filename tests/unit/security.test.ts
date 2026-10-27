import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  hash,
  opaque,
  seal,
  unseal,
  rateKey,
  validateImage,
  credentials,
  projectInput,
} from "../../server/security.js";
import { loadConfig } from "../../server/config.js";
test("session tokens are opaque; encrypted tokens reject tampering and wrong keys", () => {
  const key = opaque();
  const token = opaque();
  assert.equal(token.length, 64);
  assert.notEqual(hash(token), token);
  const sealed = seal({ refresh_token: token }, key);
  assert(!sealed.includes(token));
  assert.deepEqual(unseal(sealed, key), { refresh_token: token });
  assert.throws(() => unseal(sealed, opaque()));
  const data = Buffer.from(sealed, "base64");
  data[data.length - 1] ^= 1;
  assert.throws(() => unseal(data.toString("base64"), key));
});
test("rate-limit keys do not expose addresses and separate operations", () => {
  const key = opaque();
  assert.equal(rateKey("127.0.0.1", "login", key).length, 64);
  assert.notEqual(
    rateKey("127.0.0.1", "login", key),
    rateKey("127.0.0.1", "upload", key),
  );
});
test("server configuration fails closed in production and does not accept non-TLS origins", () => {
  assert.equal(loadConfig({}), null);
  assert.throws(() => loadConfig({ NODE_ENV: "production" }));
  assert.throws(() =>
    loadConfig({
      NODE_ENV: "production",
      APP_ORIGIN: "http://example.com",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "a".repeat(30),
      SUPABASE_SECRET_KEY: "b".repeat(30),
      SESSION_ENCRYPTION_KEY: opaque(),
      RATE_LIMIT_KEY: opaque(),
    }),
  );
});
test("validation rejects weak passwords, unknown fields, and invalid project audiences", () => {
  assert(
    !credentials.safeParse({ email: "invalid", password: "short" }).success,
  );
  assert(
    !credentials.safeParse({
      email: "test@example.com",
      password: "long-strong-password",
      admin: true,
    }).success,
  );
  assert(
    !projectInput.safeParse({ name: " ", audience: "individual" }).success,
  );
  assert(!projectInput.safeParse({ name: "Test", audience: "admin" }).success);
});
test("real image decoding strips metadata, normalizes output, and validates dimensions", async () => {
  const input = await sharp({
    create: { width: 128, height: 100, channels: 3, background: "#0EA5E9" },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const image = await validateImage(input);
  const meta = await sharp(image.bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 128);
  assert.equal(meta.height, 100);
  assert.equal(meta.exif, undefined);
  assert.equal(image.checksum, hash(image.bytes));
});
test("invalid, oversized, undersized, and unsupported image contents are rejected", async () => {
  await assert.rejects(
    validateImage(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
      ),
    ),
  );
  await assert.rejects(validateImage(Buffer.from("not an image")));
  await assert.rejects(validateImage(Buffer.alloc(10 * 1024 * 1024 + 1)));
  await assert.rejects(
    validateImage(
      await sharp({
        create: { width: 32, height: 32, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
    ),
  );
});
