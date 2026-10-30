import { test, expect } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111";
const routes = [
  ["/app", "Your projects"],
  ["/app/production-hub", "Production Hub"],
  ["/app/library", "Image library"],
  ["/app/batches", "Bulk processing"],
  ["/app/brands", "Brand Studio"],
  ["/app/billing", "Plan & usage"],
  ["/app/profile", "Profile & account"],
  [`/app/projects/${id}`, "Audit collection"],
];
const publicPaths = new Set([
  "/",
  "/pricing",
  "/terms",
  "/privacy",
  "/cookies",
  "/legal",
]);
const knownPrivate = (path) =>
  [
    "/app",
    "/app/production-hub",
    "/app/library",
    "/app/batches",
    "/app/brands",
    "/app/billing",
    "/app/profile",
    "/app/welcome",
    "/app/checkout",
  ].includes(path) ||
  /^\/app\/(projects|edit|edits|packs|batches)\/[a-f0-9-]{36}$/.test(path) ||
  /^\/app\/packs\/new\/[a-f0-9-]{36}$/.test(path);
async function fixture(page) {
  const errors = [],
    writes = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const projects = [
    {
      id,
      name: "Audit collection",
      audience: "ecommerce",
      archived: false,
      created_at: "2026-10-01T00:00:00Z",
      metadata_available: true,
      asset_count: 0,
      last_activity_at: "2026-10-01T00:00:00Z",
      last_operation: null,
    },
  ];
  const billing = {
    purchasing_enabled: false,
    plan: "free",
    account: { balance_credits: 0, reserved_credits: 0 },
    usage: {
      storage_bytes: 0,
      images: 0,
      projects: 1,
      completed_edits: 0,
      bulk_requests: 0,
      brand_profiles: 0,
    },
    limits: { storage_bytes: 262144000, images: 100, projects: 100 },
    subscriptions: [],
    receipts: [],
  };
  await page.route(/\/app(?:\/.*)?(?:\?.*)?$/, async (r) =>
    r.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (r) => {
    const req = r.request(),
      path = new URL(req.url()).pathname;
    if (req.method() !== "GET") {
      writes.push(path);
      return r.fulfill({
        status: 405,
        json: { error: { message: "Navigation audit is read-only" } },
      });
    }
    let body;
    if (path === "/api/session")
      body = {
        profile: { display_name: "Audit owner", audience: "ecommerce" },
      };
    else if (
      path === "/api/projects" ||
      path === "/api/projects/directory" ||
      path === "/api/library/projects"
    )
      body = { projects };
    else if (path === "/api/library") body = { images: [], next_offset: null };
    else if (path === "/api/images") body = { images: [] };
    else if (path === "/api/brands") body = { profiles: [] };
    else if (path === "/api/brands/assets") body = { assets: [] };
    else if (
      path === "/api/brands/capabilities" ||
      path === "/api/library/capabilities"
    )
      body = { available: true, retention_days: 30 };
    else if (
      path === "/api/processing/capabilities" ||
      path === "/api/packs/capabilities"
    )
      body = { enabled: false, history_available: false };
    else if (path === "/api/batches/capabilities")
      body = {
        available: false,
        max_images: 5,
        max_bytes: 52428800,
        file_bytes: 10485760,
        formats: ["image/webp", "image/jpeg", "image/png"],
      };
    else if (path === "/api/batches") body = { batches: [], next_offset: null };
    else if (
      path === "/api/billing/overview" ||
      path === "/api/billing/account"
    )
      body = billing;
    else if (path === "/api/account")
      body = {
        account: {
          email: "audit@example.test",
          email_verified: true,
          created_at: "2026-10-01T00:00:00Z",
          providers: ["email"],
          details: { job_title: "", location: "", time_zone: "UTC" },
        },
      };
    else
      return r.fulfill({
        status: 404,
        json: { error: { message: "Unknown audit endpoint " + path } },
      });
    await r.fulfill({ json: body });
  });
  return { errors, writes };
}
test("all main dashboard screens expose registered destinations and existing fragment targets without changing data", async ({
  page,
}) => {
  const f = await fixture(page);
  const publicCache = new Map();
  let checked = 0;
  for (const [path, title] of routes) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator("meta[name=robots]")).toHaveAttribute(
      "content",
      "noindex,nofollow",
    );
    const refs = await page
      .locator("a[href]")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const ref of refs) {
      expect(ref, "Empty link in " + path).toBeTruthy();
      expect(ref, "Placeholder link in " + path).not.toBe("#");
      const url = new URL(ref, page.url());
      expect(url.origin).toBe(new URL(page.url()).origin);
      if (url.pathname.startsWith("/api/")) continue;
      if (publicPaths.has(url.pathname)) {
        if (!publicCache.has(url.pathname)) {
          const r = await page.request.get(url.pathname);
          expect(r.status()).toBe(200);
          publicCache.set(url.pathname, await r.text());
        }
        if (url.hash) {
          const fragment = decodeURIComponent(url.hash.slice(1));
          const ids = await page.evaluate(
            (html) =>
              [
                ...new DOMParser()
                  .parseFromString(html, "text/html")
                  .querySelectorAll("[id]"),
              ].map((n) => n.id),
            publicCache.get(url.pathname),
          );
          expect(ids, ref + " public fragment").toContain(fragment);
        }
      } else
        expect(
          knownPrivate(url.pathname) || url.pathname.startsWith("/account/"),
          ref + " route from " + path,
        ).toBeTruthy();
      if (url.pathname === path && url.hash) {
        const target = await page.evaluate(
          (fragment) =>
            !!document.getElementById(decodeURIComponent(fragment.slice(1))),
          url.hash,
        );
        expect(target, ref + " fragment from " + path).toBeTruthy();
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(80);
  expect(f.errors).toEqual([]);
  expect(f.writes).toEqual([]);
});

test("unknown and malformed workspace fragments do not interrupt the loaded screen", async ({
  page,
}) => {
  const f = await fixture(page);
  for (const hash of ["#not-a-real-section", "#%E0%A4%A"]) {
    await page.goto("/app" + hash);
    await expect(
      page.getByRole("heading", { name: "Your projects", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#projects-results article")).toHaveCount(1);
  }
  expect(f.errors).toEqual([]);
  expect(f.writes).toEqual([]);
});
