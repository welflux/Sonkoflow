// Read-only audit of public page links and fragment destinations. No forms are submitted.
import { spawnSync } from "node:child_process";
const base = process.argv[2] || "https://sonkoflow.com",
  origin = new URL(base);
if (
  origin.origin !== base ||
  !(
    origin.protocol === "https:" ||
    (origin.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(origin.hostname))
  )
)
  throw Error(
    "Supply an HTTPS origin without a trailing slash, or a local test origin.",
  );
const seeds = [
  "/",
  "/pricing",
  "/terms",
  "/privacy",
  "/cookies",
  "/legal",
  "/account/signin",
  "/account/signup",
  "/account/recover",
];
const cache = new Map(),
  failures = [],
  links = [];
function get(url) {
  const key = url.origin + url.pathname + url.search;
  if (cache.has(key)) return cache.get(key);
  const r = spawnSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      "15",
      "--write-out",
      "\nLINK_AUDIT_STATUS:%{http_code}",
      key,
    ],
    { encoding: "utf8", maxBuffer: 3 * 1024 * 1024 },
  );
  const marker = r.stdout?.match(/\nLINK_AUDIT_STATUS:(\d+)$/);
  const page = {
    status: Number(marker?.[1] || 0),
    body: marker ? r.stdout.slice(0, marker.index) : "",
    ids: new Set(),
  };
  page.ids = new Set(
    [...page.body.matchAll(/\b(?:id|name)\s*=\s*(["'])(.*?)\1/g)].map(
      (m) => m[2],
    ),
  );
  cache.set(key, page);
  return page;
}
for (const path of seeds) {
  const url = new URL(path, base),
    page = get(url);
  if (page.status !== 200) {
    failures.push({ page: path, reason: "page_http_" + page.status });
    continue;
  }
  for (const m of page.body.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gs)) {
    const href = m[2].replaceAll("&amp;", "&");
    if (!href || href === "#" || /^javascript:/i.test(href)) {
      failures.push({
        page: path,
        href,
        reason: "empty_or_script_destination",
      });
      continue;
    }
    if (/^(mailto:|tel:)/i.test(href)) continue;
    let target;
    try {
      target = new URL(href, url);
    } catch {
      failures.push({ page: path, href, reason: "invalid_url" });
      continue;
    }
    if (target.origin !== origin.origin) continue;
    links.push({ page: path, href, target });
  }
}
for (const { page, href, target } of links) {
  const destination = get(target);
  if (target.pathname === "/app" || target.pathname.startsWith("/app/")) {
    if (![200, 302, 303, 307, 308].includes(destination.status))
      failures.push({
        page,
        href,
        reason: "private_route_http_" + destination.status,
      });
    continue;
  }
  if (destination.status !== 200) {
    failures.push({
      page,
      href,
      reason: "destination_http_" + destination.status,
    });
    continue;
  }
  if (target.hash) {
    let id;
    try {
      id = decodeURIComponent(target.hash.slice(1));
    } catch {
      failures.push({ page, href, reason: "invalid_fragment_encoding" });
      continue;
    }
    if (!destination.ids.has(id))
      failures.push({ page, href, reason: "fragment_missing", id });
  }
}
console.log(
  JSON.stringify(
    {
      origin: base,
      pagesAudited: seeds.length,
      internalLinkOccurrences: links.length,
      uniqueDestinations: new Set(
        links.map((l) => l.target.pathname + l.target.search + l.target.hash),
      ).size,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
