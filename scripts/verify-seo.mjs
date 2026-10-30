// Read-only raw-response validation; does not log in, submit forms or contact validators.
import { spawnSync } from "node:child_process";
import { allPages, origin } from "../content/seo-pages.mjs";
const base = process.argv[2] || origin,
  target = new URL(base);
if (
  target.origin !== base ||
  !(
    target.protocol === "https:" ||
    (target.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(target.hostname))
  )
)
  throw Error(
    "Supply an HTTPS origin or local test origin without a trailing slash.",
  );
function get(path) {
  const r = spawnSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      "15",
      "--dump-header",
      "-",
      "--write-out",
      "\nSEO_STATUS:%{http_code}",
      base + path,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const marker = r.stdout?.match(/\nSEO_STATUS:(\d+)$/);
  let body = marker ? r.stdout.slice(0, marker.index) : "",
    headers = "";
  // curl can include a CONNECT response before the actual HTTPS headers.
  while (/^HTTP\/\S+\s+\d{3}/.test(body)) {
    const split = body.indexOf("\r\n\r\n");
    if (split < 0) break;
    headers = body.slice(0, split).toLowerCase();
    body = body.slice(split + 4);
  }
  return { status: Number(marker?.[1] || 0), headers, body };
}
const checks = [];
function record(name, ok) {
  checks.push({ name, ok });
}
for (const page of allPages) {
  const r = get(page.path);
  record(page.path + ":http", r.status === 200);
  record(page.path + ":one_h1", (r.body.match(/<h1\b/g) || []).length === 1);
  record(
    page.path + ":canonical",
    r.body.includes(`rel="canonical" href="${origin + page.path}"`),
  );
  record(
    page.path + ":indexable",
    /name="robots"\s+content="index,follow,max-image-preview:large"/.test(
      r.body,
    ) && !r.headers.includes("x-robots-tag: noindex"),
  );
  record(
    page.path + ":social",
    r.body.includes('property="og:image"') &&
      r.body.includes('name="twitter:card"'),
  );
  let graph;
  try {
    graph = JSON.parse(
      r.body.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
      )?.[1] || "",
    );
  } catch {}
  record(
    page.path + ":structured_data",
    Array.isArray(graph?.["@graph"]) &&
      graph["@graph"].some(
        (n) => n["@type"] === "WebPage" && n.url === origin + page.path,
      ) &&
      graph["@graph"].some(
        (n) => n["@type"] === "SoftwareApplication" && n.name === "SonkoFlow",
      ),
  );
}
const sitemap = get("/sitemap.xml"),
  robots = get("/robots.txt");
record(
  "sitemap",
  sitemap.status === 200 &&
    sitemap.body.includes("http://www.sitemaps.org/schemas/sitemap/0.9") &&
    allPages.every((p) =>
      sitemap.body.includes(`<loc>${origin + p.path}</loc>`),
    ) &&
    !/<loc>[^<]*\/(?:app|account|api)(?:\/|<)/.test(sitemap.body),
);
record(
  "robots",
  robots.status === 200 &&
    robots.body.includes("Sitemap: " + origin + "/sitemap.xml") &&
    robots.body.includes("Disallow: /app") &&
    robots.body.includes("Disallow: /account"),
);
for (const path of [
  "/app",
  "/app/production-hub",
  "/account/signin",
  "/api/session",
]) {
  const r = get(path);
  record(
    path + ":private_noindex",
    r.headers.includes("x-robots-tag: noindex, nofollow") &&
      (path.startsWith("/app")
        ? r.status === 302
        : path === "/api/session"
          ? r.status === 401
          : r.status === 200),
  );
}
for (const path of [
  "/dashboard",
  "/projects",
  "/image-library",
  "/brand-studio",
]) {
  const r = get(path);
  record(
    path + ":legacy_missing",
    r.status === 404 && r.headers.includes("x-robots-tag: noindex, nofollow"),
  );
}
console.log(
  JSON.stringify(
    {
      origin: base,
      passed: checks.filter((c) => c.ok).length,
      total: checks.length,
      checks,
    },
    null,
    2,
  ),
);
if (checks.some((c) => !c.ok)) process.exitCode = 1;
