import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/app.js";

test("published legal information delivers legal metadata and 11 sections with canonical publication dates", async () => {
  const app = createApp(null);
  const response = await request(app).get("/legal");
  assert.equal(response.status, 200);
  assert.equal(response.headers["x-robots-tag"], undefined);
  assert.match(
    response.text,
    /rel="canonical" href="https:\/\/sonkoflow.com\/legal"/,
  );
  assert.match(
    response.text,
    /name="robots" content="index,follow,max-image-preview:large"/,
  );
  assert.equal(
    (response.text.match(/class="terms-section"/g) || []).length,
    11,
  );
  assert.doesNotMatch(
    response.text,
    /\[Insert |Document not yet published|content will be added/,
  );
  assert.doesNotMatch(
    response.text,
    /Registered business address:|Address for legal service:/,
  );
  assert.match(response.text, /General correspondence:/);
  const graph = JSON.parse(
    response.text.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )![1],
  );
  const page = graph["@graph"].find((node: any) => node["@type"] === "WebPage");
  assert.equal(page.url, "https://sonkoflow.com/legal");
  assert.equal(page.datePublished, "2026-10-30");
  assert.equal(page.dateModified, "2026-10-30");
  assert.match(
    (await request(app).get("/sitemap.xml")).text,
    /<loc>https:\/\/sonkoflow.com\/legal<\/loc>/,
  );
});
