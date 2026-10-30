import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const id = "11111111-1111-4111-8111-111111111111",
  second = "22222222-2222-4222-8222-222222222222";
const photo = await readFile("public/images/footwear-small.webp");
async function fixture(page, options = {}) {
  const state = { posts: [], reads: [], errors: [], release: null };
  let first = true;
  page.on("pageerror", (e) => state.errors.push(e.message));
  const wait = options.delayFirst
    ? new Promise((resolve) => (state.release = resolve))
    : Promise.resolve();
  await page.route(/\/app(?:\/.*)?(?:\?.*)?$/, async (r) =>
    r.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (r) => {
    const req = r.request(),
      url = new URL(req.url()),
      path = url.pathname;
    state.reads.push(path + url.search);
    if (req.method() !== "GET") state.posts.push(path);
    let body = {};
    if (path === "/api/session")
      body = {
        profile: { display_name: "Creative owner", audience: "ecommerce" },
      };
    else if (path === "/api/processing/capabilities") {
      if (options.capFailure)
        return r.fulfill({
          status: 503,
          json: { error: { message: "Unavailable" } },
        });
      body = {
        enabled: !!options.enabled,
        qualities: options.enabled ? ["low", "medium", "high"] : [],
        billing_plan: "free",
      };
    } else if (path === "/api/library") {
      const isFirst = first;
      first = false;
      if (options.failRead && isFirst)
        return r.fulfill({
          status: 503,
          json: { error: { message: "Private library unavailable" } },
        });
      const item = {
        id,
        filename: options.malicious
          ? "<img src=x onerror=alert(1)>.webp"
          : "Original product.webp",
        project_name: "Autumn collection",
        role: "original",
        image_status: "ready",
      };
      const data = options.empty
        ? []
        : url.searchParams.get("offset") === "24"
          ? [{ ...item, id: second, filename: "Second original.webp" }]
          : [
              {
                ...item,
                filename: options.delayFirst
                  ? isFirst
                    ? "Stale original.webp"
                    : "Current original.webp"
                  : item.filename,
              },
              {
                ...item,
                id: second,
                role: "generated",
                filename: "Generated.webp",
              },
              {
                ...item,
                id: "33333333-3333-4333-8333-333333333333",
                trashed_at: "2026-10-30T00:00:00Z",
                filename: "Trashed.webp",
              },
            ];
      if (options.delayFirst && isFirst) await wait;
      body = {
        images: data,
        next_offset: options.paginate && isFirst ? 24 : null,
      };
    } else if (path.endsWith("/thumbnail") || path.endsWith("/content"))
      return r.fulfill({ body: photo, contentType: "image/webp" });
    else if (path.startsWith("/api/images/"))
      body = {
        image: {
          id,
          role: "original",
          status: "ready",
          filename: "Original product.webp",
          audience: "individual",
          project_id: second,
          width: 1024,
          height: 768,
        },
      };
    else
      return r.fulfill({
        status: 404,
        json: { error: { message: "Unexpected endpoint " + path } },
      });
    try {
      await r.fulfill({ json: body });
    } catch (error) {
      if (!options.delayFirst) throw error;
    }
  });
  await page.goto("/app/production-hub");
  return state;
}
test("visual toolkit has eleven illustrated real features, one active navigation entry, honest artwork labels and no automatic asset access or mutations", async ({
  page,
}) => {
  const s = await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Production Hub", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Production Hub — SonkoFlow");
  await expect(page.locator(".hub-tool-card")).toHaveCount(11);
  await expect(page.locator("#hub-tool-count")).toHaveText("11 tools");
  await expect(page.locator(".hub-art img")).toHaveCount(20);
  await expect(
    page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("link", { name: "Production Hub", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".hub-artwork-note")).toContainText(
    "not customer photographs or results generated",
  );
  await expect(page.locator("#hub-availability")).toContainText(
    "awaiting service activation",
  );
  await expect(page.locator("#hub-source-picker")).not.toBeVisible();
  expect(s.reads.filter((p) => p.startsWith("/api/library"))).toEqual([]);
  expect(s.posts).toEqual([]);
  expect(s.errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  if (page.viewportSize().width > 1024) {
    const side = await page.locator(".sidebar").boundingBox(),
      a = await page.locator(".sidebar a[aria-current=page]").boundingBox();
    expect(side.x + side.width - a.x - a.width).toBe(9);
  }
});
test("categories and keyword search filter the actual toolkit and clear back to every feature", async ({
  page,
}) => {
  const s = await fixture(page);
  await page
    .getByRole("button", { name: "Photo editing", exact: true })
    .click();
  await expect(page.locator(".hub-tool-card:visible")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Product production", exact: true })
    .click();
  await expect(page.locator(".hub-tool-card:visible")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Your workflow", exact: true })
    .click();
  await expect(page.locator(".hub-tool-card:visible")).toHaveCount(4);
  await page.getByRole("button", { name: "All tools", exact: true }).click();
  await page.getByLabel("Find a tool", { exact: true }).fill("logo");
  await expect(page.locator(".hub-tool-card:visible")).toHaveCount(1);
  await expect(page.locator(".hub-tool-card:visible")).toContainText(
    "Brand Studio",
  );
  await page.getByLabel("Find a tool", { exact: true }).fill("missing feature");
  await expect(
    page.getByRole("heading", { name: "No tools match this search" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all tools" }).click();
  await expect(page.locator(".hub-tool-card:visible")).toHaveCount(11);
  expect(s.posts).toEqual([]);
});
test("hero subjects are interactive and the chosen workflow uses private ready originals without generating", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.getByRole("button", { name: "Portraits", exact: true }).click();
  await expect(page.locator("#hub-hero-photo")).toHaveAttribute(
    "src",
    "/images/portrait.webp",
  );
  await page.locator("#hub-start").click();
  await expect(page.getByLabel("Workflow", { exact: true })).toHaveValue(
    "portrait",
  );
  await expect(page.locator(".hub-source-card")).toHaveCount(1);
  await expect(page.locator(".hub-source-card")).toHaveAttribute(
    "href",
    `/app/edit/${id}?mode=portrait`,
  );
  await page.getByLabel("Workflow", { exact: true }).selectOption("pack");
  await expect(page.locator(".hub-source-card")).toHaveAttribute(
    "href",
    `/app/packs/new/${id}`,
  );
  await expect(page.locator("#hub-picker-help")).toContainText(
    "original product photograph",
  );
  await page.getByLabel("Close photograph picker").click();
  await expect(page.locator("#hub-start")).toBeFocused();
  expect(s.posts).toEqual([]);
  expect(s.reads.some((p) => p.endsWith("/content"))).toBeFalsy();
  expect(s.errors).toEqual([]);
});
test("tool card handoff preselects its supported editor mode and leaves provider consent unchecked", async ({
  page,
}) => {
  const s = await fixture(page);
  await page
    .getByRole("button", { name: "Create a portrait", exact: true })
    .click();
  await expect(page.locator(".hub-source-card")).toHaveCount(1);
  await page.locator(".hub-source-card").click();
  await expect(page).toHaveURL(`/app/edit/${id}?mode=portrait`);
  await expect(page.getByLabel("Enhancement mode")).toHaveValue("portrait");
  await expect(page.locator("#mode-description")).toContainText("headshot");
  await expect(page.locator("[name=provider_consent]")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Generate edited photograph" }),
  ).toBeDisabled();
  expect(s.posts).toEqual([]);
});
test("picker pagination, local filtering and hostile filenames retain private link boundaries", async ({
  page,
}) => {
  const s = await fixture(page, { paginate: true, malicious: true });
  await page
    .getByRole("button", { name: "Build an image pack", exact: true })
    .click();
  await expect(page.locator(".hub-source-card")).toHaveCount(1);
  await expect(page.locator(".hub-source-card strong")).toHaveText(
    "<img src=x onerror=alert(1)>.webp",
  );
  await page
    .locator(".hub-source-card img")
    .first()
    .evaluate((img) => {
      window.hubRetainedThumbnail = img;
    });
  await page.getByRole("button", { name: "Load more originals" }).click();
  await expect(page.locator(".hub-source-card")).toHaveCount(2);
  await page.getByLabel("Filter loaded originals").fill("second");
  await expect(page.locator(".hub-source-card")).toHaveCount(1);
  await expect(page.locator(".hub-source-card")).toHaveAttribute(
    "href",
    `/app/packs/new/${second}`,
  );
  await page.getByLabel("Filter loaded originals").fill("");
  expect(
    await page
      .locator(".hub-source-card img")
      .first()
      .evaluate((img) => img === window.hubRetainedThumbnail),
  ).toBeTruthy();
  expect(s.reads).toContain("/api/library?role=original&offset=24");
  expect(s.posts).toEqual([]);
  expect(s.errors).toEqual([]);
});
test("service failures are explicit, retry works, and an empty library offers a real upload route", async ({
  page,
}) => {
  const s = await fixture(page, {
    failRead: true,
    capFailure: true,
    empty: true,
  });
  await expect(page.locator("#hub-availability")).toContainText(
    "could not be checked",
  );
  await page.locator("#hub-start").click();
  await expect(page.locator("#hub-picker-notice")).toContainText(
    "Private library unavailable",
  );
  await expect(
    page.getByRole("heading", { name: "No ready originals yet" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Retry loading originals" }).click();
  await expect(
    page.getByRole("heading", { name: "No ready originals yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open image library ↗", exact: true }),
  ).toHaveAttribute("href", "/app/library");
  expect(s.posts).toEqual([]);
});
test("closing and reopening the picker discards late responses from the previous workflow", async ({
  page,
}) => {
  const s = await fixture(page, { delayFirst: true });
  await page.locator("#hub-start").click();
  await expect
    .poll(() => s.reads.filter((p) => p.startsWith("/api/library?")).length)
    .toBe(1);
  await page.getByLabel("Close photograph picker").click();
  await page
    .getByRole("button", { name: "Create a portrait", exact: true })
    .click();
  await expect(page.locator(".hub-source-card")).toContainText(
    "Current original.webp",
  );
  s.release();
  await expect(page.locator(".hub-source-card")).toHaveCount(1);
  await expect(page.locator("#hub-source-grid")).not.toContainText(
    "Stale original.webp",
  );
  expect(s.posts).toEqual([]);
});
test("reduced motion preserves every visual and workflow links target existing workspace screens", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page, { enabled: true });
  await expect(page.locator(".hub-hero-portrait")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator("#hub-availability")).toBeHidden();
  await page.getByLabel("Illustrative warm-light balance").fill("75");
  await expect(page.locator(".hub-art-lighting")).toHaveCSS(
    "--hub-light-balance",
    "75%",
  );
  await expect(page.locator("#hub-path-title")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  const expected = {
    "Prepare a batch": "/app/batches",
    "Open Brand Studio": "/app/brands",
    "Review saved results": "/app/library?role=generated&review=pending",
    "Browse image library": "/app/library",
    "Open project directory": "/app",
    "Find saved downloads": "/app/library?role=generated",
  };
  for (const [name, href] of Object.entries(expected))
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      href,
    );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
