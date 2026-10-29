import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const project = "11111111-1111-4111-8111-111111111111",
  image = "22222222-2222-4222-8222-222222222222",
  variant = "33333333-3333-4333-8333-333333333333",
  job = "44444444-4444-4444-8444-444444444444",
  pack = "55555555-5555-4555-8555-555555555555",
  batch = "66666666-6666-4666-8666-666666666666";
const photo = await readFile("public/images/footwear-small.webp");
const file = (name = "source.webp") => ({
  name,
  mimeType: "image/webp",
  buffer: photo,
});
async function fixture(page, options = {}) {
  const base = {
    role: "original",
    filename: "Product linen.webp",
    width: 1024,
    height: 768,
    byte_size: 24576,
    media_type: "image/webp",
    created_at: "2026-10-28T10:00:00Z",
    library_project_id: project,
    project_id: project,
    project_name: "Product collection",
    archived: false,
    image_status: "ready",
    mode: "product",
    processing_status: "completed",
    quality_state: "completed",
    user_decision: "approved",
    trashed_at: null,
  };
  const state = {
    images: options.empty
      ? []
      : [
          { ...base, id: image },
          {
            ...base,
            id: variant,
            filename: "Product variant.webp",
            role: "generated",
            job_id: job,
            pack_id: pack,
            batch_id: batch,
          },
        ],
    projects: [
      {
        id: project,
        name: "Product collection",
        audience: "ecommerce",
        archived: false,
      },
    ],
    queries: [],
    actions: [],
    uploads: [],
    posts: [],
    history: [],
    errors: [],
  };
  if (options.many)
    state.images = Array.from({ length: 105 }, (_, i) => ({
      ...base,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      filename: `Product ${String(i).padStart(3, "0")}.webp`,
    }));
  page.on("pageerror", (e) => state.errors.push(e.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (id) => (window.copiedLibraryId = id) },
    }),
  );
  await page.route("**/app/**", async (r) =>
    r.fulfill({ response: await page.request.get("/account/signin") }),
  );
  let failed = false,
    uploadFailed = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (request.method() === "POST") state.posts.push(path);
    let body = {};
    if (path === "/api/session")
      body = {
        profile: { display_name: "Asset manager", audience: "ecommerce" },
      };
    else if (path === "/api/library/capabilities")
      body = { available: !options.unavailable, retention_days: 30 };
    else if (path === "/api/library/projects")
      body = { projects: state.projects };
    else if (path === "/api/library") {
      state.queries.push(url.searchParams.toString());
      if (options.failLoad && !failed) {
        failed = true;
        return route.fulfill({
          status: 503,
          json: { error: { message: "Storage metadata unavailable" } },
        });
      }
      let data = state.images.filter(
        (i) => !!i.trashed_at === (url.searchParams.get("trash") === "1"),
      );
      const search = url.searchParams.get("search")?.toLowerCase();
      if (search)
        data = data.filter((i) =>
          (i.filename + " " + i.project_name).toLowerCase().includes(search),
        );
      if (url.searchParams.get("role"))
        data = data.filter((i) => i.role === url.searchParams.get("role"));
      const offset = Number(url.searchParams.get("offset") || 0);
      body = {
        images: data.slice(offset, offset + 24),
        next_offset: offset + 24 < data.length ? offset + 24 : null,
      };
    } else if (path === "/api/library/actions") {
      const b = request.postDataJSON();
      state.actions.push(b);
      if (options.failAction)
        return route.fulfill({
          status: 409,
          json: {
            error: { message: "Active processing prevents this action" },
          },
        });
      for (const i of state.images.filter((i) => b.ids.includes(i.id))) {
        if (b.action === "rename") i.filename = b.value;
        if (b.action === "move") i.library_project_id = b.value;
        if (b.action === "trash") i.trashed_at = new Date().toISOString();
        if (b.action === "restore") i.trashed_at = null;
      }
      body = { updated: b.ids.length };
    } else if (path === "/api/projects" && request.method() === "POST") {
      const b = request.postDataJSON();
      state.projects.push({
        id: variant,
        name: b.name,
        audience: b.audience,
        archived: false,
      });
      body = { id: variant };
    } else if (path.startsWith("/api/library/projects/")) {
      const b = request.postDataJSON(),
        p = state.projects.find((p) => p.id === path.split("/").at(-1));
      if (b.action === "delete")
        return route.fulfill({
          status: 409,
          json: {
            error: {
              message: "This project still holds photographs or source records",
            },
          },
        });
      if (b.action === "rename") p.name = b.value;
      if (b.action === "archive") p.archived = true;
      if (b.action === "restore") p.archived = false;
      body = { ok: true };
    } else if (path === "/api/images" && request.method() === "POST") {
      const data = await new Response(request.postDataBuffer(), {
        headers: { "content-type": await request.headerValue("content-type") },
      }).formData();
      state.uploads.push({
        id: data.get("id"),
        project_id: data.get("project_id"),
        filename: data.get("image").name,
      });
      if (options.loseUpload && !uploadFailed) {
        uploadFailed = true;
        return route.fulfill({
          status: 503,
          json: { error: { message: "Upload acknowledgement interrupted" } },
        });
      }
      if (!state.images.some((i) => i.id === data.get("id")))
        state.images.push({
          ...base,
          id: data.get("id"),
          filename: data.get("image").name,
        });
      return route.fulfill({ status: 201, json: {} });
    } else if (path.endsWith("/history")) {
      const id = path.split("/")[3];
      state.history.push(id);
      const current = state.images.find((i) => i.id === id);
      body = {
        image: { id },
        jobs: [
          {
            id: job,
            status: "completed",
            mode: "product",
            input_image_id: image,
            output_image_id: variant,
            instructions: "Keep the real label <unchanged>",
            settings: {
              brand_snapshot: {
                profile_name: "Aster Brand",
                profile_id: project,
                profile_revision: 3,
              },
            },
            quality_state: "completed",
            user_decision: "approved",
            pack_id: pack,
            created_at: "2026-10-29T12:00:00Z",
          },
        ],
        next_offset: null,
      };
    } else if (path.endsWith("/thumbnail") || path.endsWith("/content"))
      return route.fulfill({ body: photo, contentType: "image/webp" });
    await route.fulfill({ json: body });
  });
  await page.goto("/app/library");
  return state;
}
async function select(page, id = image) {
  await page.locator(`[data-asset-id="${id}"] input[type=checkbox]`).check();
}
async function batchMenu(page) {
  await page.locator("#library-batch-toggle").click();
}

test("asset ledger is the default, filters are compact and project governance is outside the main canvas", async ({
  page,
}) => {
  const s = await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Image library", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".library-ledger tbody tr")).toHaveCount(2);
  await expect(page.locator(".library-filter-panel")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator("#library-project-dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Project organization" }),
  ).toHaveCount(0);
  await expect(page.locator("#library-batch-toggle")).toBeDisabled();
  await expect(page.locator("#library-loaded")).toHaveText("2 assets loaded");
  await expect(page.locator(".library-ledger th")).toContainText([
    "",
    "Preview",
    "Asset detail & ID",
    "Project",
    "Mode",
    "Lifecycle",
    "Dimensions",
    "Audit review",
    "Actions",
  ]);
  await expect(page.locator(".sidebar a[aria-current=page]")).toHaveCSS(
    "border-radius",
    "6px",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByLabel("Storage and recovery information", { exact: true })
    .click();
  const info = await page.locator(".library-storage-info > div").boundingBox();
  expect(info.x).toBeGreaterThanOrEqual(0);
  expect(info.x + info.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page
    .getByLabel("Storage and recovery information", { exact: true })
    .click();
  expect(s.posts).toEqual([]);
  expect(s.errors).toEqual([]);
});

test("filters use supported server query fields, update the URL and reset without an empty settings form", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.getByText("Advanced filters", { exact: true }).click();
  await page
    .getByLabel("Image type", { exact: true })
    .selectOption("generated");
  await expect.poll(() => s.queries.at(-1)).toContain("role=generated");
  await expect(page.locator(".library-card")).toHaveCount(1);
  await page.getByLabel("From (UTC)").fill("2026-10-01");
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await expect.poll(() => s.queries.at(-1)).toContain("after=2026-10-01T00");
  await page.getByLabel("Search images or projects").fill("no matching file");
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No assets match these filters" }),
  ).toBeVisible();
  await page.locator("#library-reset").click();
  await expect(page.locator(".library-card")).toHaveCount(2);
  await expect(page).not.toHaveURL(/role=generated/);
  expect(s.posts).toEqual([]);
  expect(s.errors).toEqual([]);
});

test("selection persists across views and density changes; clipboard and private downloads use actual asset IDs", async ({
  page,
}) => {
  const s = await fixture(page);
  await select(page);
  await expect(page.locator("#library-count")).toHaveText("1 selected");
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator("#library-results")).toHaveClass("library-grid");
  await expect(page.locator(`[data-asset-id="${image}"] input`)).toBeChecked();
  await page.locator("#library-density").fill("88");
  await expect(page.locator("#library-results")).toHaveCSS(
    "--library-thumb",
    "88px",
  );
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Copy asset ID for Product linen.webp",
      exact: true,
    })
    .click();
  expect(await page.evaluate(() => window.copiedLibraryId)).toBe(image);
  await batchMenu(page);
  await page
    .getByRole("button", { name: "Download links", exact: true })
    .click();
  await expect(page.locator("#library-download-dialog")).toBeVisible();
  await expect(page.locator("#library-download-links a")).toHaveAttribute(
    "href",
    `/api/images/${image}/content?download=1`,
  );
  await page.getByRole("button", { name: "Close downloads" }).click();
  expect(s.posts).toEqual([]);
  expect(s.errors).toEqual([]);
});

test("preview loads full content only on request and exposes stored source, brand, instructions, pack and batch lineage", async ({
  page,
}) => {
  const s = await fixture(page);
  await expect(page.locator("#library-preview img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Preview Product variant.webp", exact: true })
    .click();
  await expect(page.locator("#library-preview img")).toHaveAttribute(
    "src",
    `/api/images/${variant}/content`,
  );
  await expect(page.locator("#library-metadata")).toContainText(variant);
  await expect(page.locator("#library-history")).toContainText("Aster Brand");
  await expect(page.locator("#library-history")).toContainText("revision 3");
  await page.getByText("Saved editing instructions", { exact: true }).click();
  await expect(page.locator("#library-history")).toContainText(
    "Keep the real label <unchanged>",
  );
  await expect(
    page.locator(`#library-history a[href="/app/edit/${image}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`#library-history a[href="/app/edits/${job}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`#library-metadata a[href="/app/batches/${batch}"]`),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#library-dialog")).not.toBeVisible();
  expect(s.actions).toEqual([]);
  expect(s.errors).toEqual([]);
});

test("project create, rename and archive are confined to the project drawer and use existing project APIs", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.locator("#library-projects-open").click();
  await expect(page.locator("#library-project-dialog")).toBeVisible();
  await page.getByText("Create a project", { exact: true }).click();
  await page.locator("#library-create [name=name]").fill("Campaign assets");
  await page.locator("#library-create button").click();
  await expect(page.locator("#library-projects")).toContainText(
    "Campaign assets",
  );
  const row = page
    .locator(".library-project-item")
    .filter({ hasText: "Campaign assets" });
  await row.getByRole("button", { name: "Rename", exact: true }).click();
  await page.locator("#library-edit-dialog input").fill("Campaign masters");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.locator("#library-projects")).toContainText(
    "Campaign masters",
  );
  await page
    .locator(".library-project-item")
    .filter({ hasText: "Campaign masters" })
    .getByRole("button", { name: "Archive project", exact: true })
    .click();
  await expect(
    page
      .locator(".library-project-item")
      .filter({ hasText: "Campaign masters" }),
  ).toContainText("Archived");
  await page.getByRole("button", { name: "Close projects" }).click();
  await expect(page.locator("#library-project-dialog")).not.toBeVisible();
  expect(
    s.projects.some((p) => p.name === "Campaign masters" && p.archived),
  ).toBeTruthy();
  expect(s.errors).toEqual([]);
});

test("failed asset actions retain selection and rows instead of fabricating mutation success", async ({
  page,
}) => {
  const s = await fixture(page, { failAction: true });
  await select(page);
  await batchMenu(page);
  await page
    .getByRole("button", { name: "Move selected", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Active processing prevents this action",
  );
  await expect(page.locator("#library-count")).toHaveText("1 selected");
  await expect(page.locator(".library-card")).toHaveCount(2);
  expect(s.actions).toHaveLength(1);
  expect(s.errors).toEqual([]);
});

test("failed reads show an explicit retry state and never claim an empty asset library", async ({
  page,
}) => {
  const s = await fixture(page, { failLoad: true });
  await expect(
    page.getByRole("heading", { name: "Your library could not load" }),
  ).toBeVisible();
  await expect(page.locator("#library-loaded")).toHaveText(
    "Library unavailable",
  );
  await expect(
    page.getByRole("heading", { name: "Your library starts with an original" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Retry library" }).click();
  await expect(page.locator(".library-card")).toHaveCount(2);
  expect(s.queries).toHaveLength(2);
  expect(s.errors).toEqual([]);
});

test("dragging originals into an empty canvas stages a private upload; an interrupted acknowledgement retries its image ID", async ({
  page,
}) => {
  const s = await fixture(page, { empty: true, loseUpload: true });
  await expect(
    page.getByRole("heading", { name: "Your library starts with an original" }),
  ).toBeVisible();
  const dt = await page.evaluateHandle(
    (bytes) => {
      const d = new DataTransfer();
      d.items.add(
        new File([new Uint8Array(bytes)], "drop.webp", { type: "image/webp" }),
      );
      return d;
    },
    [...photo],
  );
  await page
    .locator("#library-results")
    .dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.locator("#library-upload-dialog")).toBeVisible();
  await expect(page.locator(".library-upload-row")).toHaveCount(1);
  expect(s.uploads).toHaveLength(0);
  await page
    .getByRole("button", { name: "Upload originals", exact: true })
    .click();
  await expect(
    page.locator("#library-upload-dialog [role=status]"),
  ).toContainText("Upload acknowledgement interrupted");
  await page
    .getByRole("button", { name: "Upload originals", exact: true })
    .click();
  await expect(
    page.locator("#library-upload-dialog [role=status]"),
  ).toContainText("uploaded privately");
  expect(s.uploads).toHaveLength(2);
  expect(s.uploads[0].id).toBe(s.uploads[1].id);
  expect(s.uploads[1].project_id).toBe(project);
  expect(s.posts.some((path) => /jobs|packs|batches/.test(path))).toBeFalsy();
  await page.getByRole("button", { name: "Close upload" }).click();
  await expect(page.locator(".library-card")).toHaveCount(1);
  expect(s.errors).toEqual([]);
});

test("invalid uploads block submission and can be excluded without dropping valid files", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.locator("#library-upload-open").click();
  await page.locator("#library-upload-dialog input[type=file]").setInputFiles([
    file(),
    {
      name: "document.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("invalid"),
    },
  ]);
  await expect(
    page.getByRole("button", { name: "Upload originals", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".library-upload-queue")).toContainText(
    "Choose JPEG, PNG or WebP",
  );
  await page
    .getByRole("button", { name: "Remove document.txt", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Upload originals", exact: true }),
  ).toBeEnabled();
  expect(s.uploads).toHaveLength(0);
  expect(s.errors).toEqual([]);
});

test("pagination preserves loaded records and limits one bulk action to 100 actual selected IDs", async ({
  page,
}) => {
  const s = await fixture(page, { many: true });
  await expect(page.locator(".library-card")).toHaveCount(24);
  const firstThumbnail = await page
    .locator(".library-thumbnail img")
    .first()
    .elementHandle();
  for (const total of [48, 72, 96, 105]) {
    await page
      .getByRole("button", { name: "Load more assets", exact: true })
      .click();
    await expect(page.locator(".library-card")).toHaveCount(total);
  }
  expect(
    await firstThumbnail.evaluate((node) => node.isConnected),
  ).toBeTruthy();
  await page
    .getByLabel("Select first 100 loaded assets", { exact: true })
    .check();
  await expect(page.locator("#library-count")).toHaveText("100 selected");
  await expect(page.locator("#library-notice")).toContainText("first 100");
  await batchMenu(page);
  await page
    .getByRole("button", { name: "Move selected", exact: true })
    .click();
  await expect.poll(() => s.actions.length).toBe(1);
  expect(s.actions[0].ids).toHaveLength(100);
  expect(new Set(s.actions[0].ids).size).toBe(100);
  expect(s.errors).toEqual([]);
});

test("a slow earlier search cannot replace a newer asset query", async ({
  page,
}) => {
  await fixture(page);
  let release,
    started = false;
  const wait = new Promise((r) => (release = r));
  await page.route("**/api/library?**", async (route) => {
    const search = new URL(route.request().url()).searchParams.get("search");
    if (search === "slow") {
      started = true;
      await wait;
      return route.fulfill({
        json: {
          images: [
            {
              id: image,
              filename: "Stale earlier asset.webp",
              role: "original",
              width: 100,
              height: 100,
              created_at: "2026-10-28T00:00:00Z",
            },
          ],
          next_offset: null,
        },
      });
    }
    return route.fulfill({ json: { images: [], next_offset: null } });
  });
  await page.getByLabel("Search images or projects").fill("slow");
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await expect.poll(() => started).toBeTruthy();
  await page.getByLabel("Search images or projects").fill("newer");
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No assets match these filters" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByText("Stale earlier asset.webp", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#library-loaded")).toHaveText("0 assets loaded");
});

test("closing a preview prevents its late history from entering the next asset inspection", async ({
  page,
}) => {
  const s = await fixture(page);
  let release,
    started = false;
  const wait = new Promise((r) => (release = r));
  await page.route(`**/api/library/${image}/history?**`, async (route) => {
    started = true;
    await wait;
    await route
      .fulfill({
        json: {
          jobs: [
            {
              id: job,
              mode: "product",
              status: "completed",
              instructions: "STALE SOURCE HISTORY",
              quality_state: "completed",
              user_decision: "approved",
              created_at: "2026-10-28T00:00:00Z",
            },
          ],
          next_offset: null,
        },
      })
      .catch(() => {});
  });
  await page
    .getByRole("button", { name: "Preview Product linen.webp", exact: true })
    .click();
  await expect.poll(() => started).toBeTruthy();
  await page.getByRole("button", { name: "Close preview" }).click();
  await page
    .getByRole("button", { name: "Preview Product variant.webp", exact: true })
    .click();
  await expect(page.locator("#library-history")).toContainText("Aster Brand");
  release();
  await expect(page.locator("#library-preview-title")).toHaveText(
    "Product variant.webp",
  );
  await expect(
    page.getByText("STALE SOURCE HISTORY", { exact: true }),
  ).toHaveCount(0);
  expect(s.errors).toEqual([]);
});
