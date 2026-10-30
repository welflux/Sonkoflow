import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { readFile } from "node:fs/promises";
import { createApp } from "../../server/app.js";
const pages = [
  "/",
  "/pricing",
  "/features/bulk-image-processing",
  "/features/ecommerce-product-photography",
  "/features/portrait-enhancer",
  "/solutions/automation",
];
test("indexable public pages serve real HTML with one H1, self canonical URLs, social metadata and supported structured data", async () => {
  const app = createApp(null);
  for (const path of pages) {
    const r = await request(app).get(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers["content-type"], /html/);
    assert.equal(r.headers["x-robots-tag"], undefined);
    assert.equal((r.text.match(/<h1\b/g) || []).length, 1, path);
    const canonicals = [
      ...r.text.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g),
    ];
    assert.equal(canonicals.length, 1, path);
    assert.equal(canonicals[0][1], "https://sonkoflow.com" + path);
    assert.match(
      r.text,
      /<meta\s+name="robots"\s+content="index,follow,max-image-preview:large"/,
    );
    assert.match(r.text, /property="og:image"/);
    assert.match(r.text, /name="twitter:card"/);
    const data = JSON.parse(
      r.text.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
      )![1],
    );
    const software = data["@graph"].find(
      (n: any) => n["@type"] === "SoftwareApplication",
    );
    assert.equal(software.name, "SonkoFlow");
    assert.equal(software.offers.name, "Free workspace account");
    assert.equal(software.aggregateRating, undefined);
    assert.ok(
      software.featureList.includes(
        "Saved brand profiles and reusable presets",
      ),
    );
    assert.ok(
      !software.featureList.some((v: string) =>
        /embeddings|parallel gpu|instant/i.test(v),
      ),
    );
    assert.equal(
      data["@graph"].find((n: any) => n["@type"] === "WebPage").url,
      "https://sonkoflow.com" + path,
    );
  }
});
test("sitemap contains only live canonical published pages and robots refers to its real URL", async () => {
  const app = createApp(null),
    sitemap = await request(app).get("/sitemap.xml"),
    robots = await request(app).get("/robots.txt");
  assert.equal(sitemap.status, 200);
  assert.match(
    sitemap.text,
    /http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9/,
  );
  const urls = [...sitemap.text.matchAll(/<loc>(.*?)<\/loc>/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    urls,
    [...pages, "/terms", "/privacy", "/cookies"].map((p) => "https://sonkoflow.com" + p),
  );
  assert.ok(
    urls.every(
      (url) =>
        !url.includes("/app") &&
        !url.includes("/account") &&
        !url.includes("/api"),
    ),
  );
  assert.equal(robots.status, 200);
  assert.match(robots.text, /Sitemap: https:\/\/sonkoflow.com\/sitemap.xml/);
  assert.match(robots.text, /Disallow: \/app/);
  assert.match(robots.text, /Disallow: \/account/);
  assert.doesNotMatch(
    robots.text,
    /Disallow: \/(?:images|assets|features|solutions)/,
  );
});
test("private and placeholder routes remain nonindexable without weakening authentication or inventing legacy content", async () => {
  const app = createApp(null);
  for (const path of [
    "/app",
    "/app/profile",
    "/app/projects/11111111-1111-4111-8111-111111111111",
    "/app.html",
    "/account/signin",
    "/account/confirm",
    "/api/session",
    "/legal",
  ]) {
    const r = await request(app).get(path);
    assert.equal(r.headers["x-robots-tag"], "noindex, nofollow", path);
    if (path.startsWith("/app")) assert.equal(r.status, 302, path);
    if (path.startsWith("/account"))
      assert.match(r.text, /<meta name="robots" content="noindex,nofollow"/);
  }
  for (const path of [
    "/dashboard",
    "/projects",
    "/image-library",
    "/brand-studio",
    "/removed-local-page",
  ]) {
    const r = await request(app).get(path);
    assert.equal(r.status, 404, path);
    assert.equal(r.headers["x-robots-tag"], "noindex, nofollow", path);
  }
});
test("public HTML aliases and feature trailing slashes redirect permanently to the correct canonical without dropping queries", async () => {
  const app = createApp(null);
  for (const [from, to] of [
    ["/index.html", "/"],
    ["/pricing.html?utm_source=test", "/pricing?utm_source=test"],
    ["/features/bulk-image-processing.html", "/features/bulk-image-processing"],
    [
      "/features/ecommerce-product-photography/",
      "/features/ecommerce-product-photography",
    ],
    ["/solutions/automation.html", "/solutions/automation"],
  ]) {
    const r = await request(app).get(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.location, to);
  }
});
test("generated public pages are reproducible from their content source and do not depend on authenticated API data", async () => {
  const source = await readFile("scripts/generate-feature-pages.mjs", "utf8");
  assert.ok(!source.includes("fetch("));
  for (const slug of [
    "features/bulk-image-processing",
    "features/ecommerce-product-photography",
    "features/portrait-enhancer",
    "solutions/automation",
  ]) {
    const html = await readFile("dist/" + slug + ".html", "utf8");
    assert.match(html, /<h1>[^<]+<\/h1>/);
    assert.doesNotMatch(
      html,
      /trained brand studio profile embeddings|parallel GPU batch processing|generated in seconds|generate.*instantly/i,
    );
  }
});
