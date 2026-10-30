import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/app.js";

test("published terms deliver legal metadata and 24 sections while other legal pages remain unpublished", async () => {
  const app = createApp(null);
  const response = await request(app).get("/terms");
  assert.equal(response.status, 200);
  assert.equal(response.headers["x-robots-tag"], undefined);
  assert.match(
    response.text,
    /rel="canonical" href="https:\/\/sonkoflow.com\/terms"/,
  );
  assert.match(
    response.text,
    /name="robots" content="index,follow,max-image-preview:large"/,
  );
  assert.equal(
    (response.text.match(/class="terms-section"/g) || []).length,
    24,
  );
  assert.doesNotMatch(
    response.text,
    /\[Insert |Document not yet published|content will be added/,
  );
  const graph = JSON.parse(
    response.text.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )![1],
  );
  const page = graph["@graph"].find((node: any) => node["@type"] === "WebPage");
  assert.equal(page.url, "https://sonkoflow.com/terms");
  assert.equal(page.datePublished, "2026-10-30");
  assert.equal(page.dateModified, "2026-10-30");
  assert.match(
    (await request(app).get("/sitemap.xml")).text,
    /<loc>https:\/\/sonkoflow.com\/terms<\/loc>/,
  );
  for (const path of ["/privacy", "/cookies", "/legal"]) {
    const other = await request(app).get(path);
    assert.equal(other.headers["x-robots-tag"], "noindex, nofollow");
    assert.match(other.text, /Document not yet published/);
  }
});
