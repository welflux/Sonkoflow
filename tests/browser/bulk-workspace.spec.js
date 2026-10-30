import { test, expect } from "@playwright/test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const project = "11111111-1111-4111-8111-111111111111",
  batch = "22222222-2222-4222-8222-222222222222",
  failed = "33333333-3333-4333-8333-333333333333";
const photo = await readFile("public/images/footwear-small.webp");
const file = (name = "product.webp") => ({
  name,
  mimeType: "image/webp",
  buffer: photo,
});
async function setup(page, options = {}) {
  const state = {
    uploads: [],
    quotes: [],
    creates: [],
    historyReads: 0,
    detailReads: 0,
    errors: [],
  };
  page.on("pageerror", (e) => state.errors.push(e.message));
  let releaseCap, releaseUpload;
  const capWait = options.delayCap
    ? new Promise((r) => (releaseCap = r))
    : Promise.resolve();
  const uploadWait = options.delayUpload
    ? new Promise((r) => (releaseUpload = r))
    : Promise.resolve();
  await page.route("**/app/**", async (r) =>
    r.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let body = {};
    if (path === "/api/session")
      body = {
        profile: { display_name: "Production owner", audience: "ecommerce" },
      };
    else if (path === "/api/projects")
      body = {
        projects: options.noProjects
          ? []
          : options.projectChoices || [{ id: project, name: "Product collection" }],
      };
    else if (path === "/api/brands/capabilities")
      body = { available: !!options.brand };
    else if (path === "/api/brands")
      body = { profiles: [{ id: project, name: "Aster Brand" }] };
    else if (path === "/api/brands/assets") body = { assets: [] };
    else if (path === `/api/brands/${project}`)
      body = {
        profile: {
          id: project,
          name: "Aster Brand",
          revision: 3,
          settings: {
            primary_color: "#142F3E",
            secondary_color: "#F7F6F2",
            accent_color: "#F4B979",
            background_style: "neutral",
            background_color: "#F7F6F2",
            theme: "restrained",
            image_style: "realistic",
            canvas: "square",
            framing: "full_product",
            spacing: "balanced",
            restrictions: "",
            instructions: "",
            logo_placement: "none",
            logo_align: "right",
          },
        },
        presets: [],
      };
    else if (path === "/api/batches/capabilities") {
      await capWait;
      body = {
        available: !options.unavailable,
        reason: options.unavailable
          ? "Bulk generation is awaiting activation."
          : null,
        max_images: options.maxImages ?? 5,
        max_bytes: 52428800,
        file_bytes: 10485760,
        formats: ["image/webp", "image/jpeg", "image/png"],
      };
    } else if (path === "/api/batches" && request.method() === "GET") {
      state.historyReads++;
      if (options.historyError && state.historyReads === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "History unavailable" } },
        });
      body = {
        batches: options.history
          ? [
              {
                id: batch,
                name: "Autumn <products>",
                project_id: project,
                created_at: "2026-10-29T10:00:00Z",
              },
              {
                id: failed,
                name: "Packaging collection",
                project_id: project,
                created_at: "2026-10-28T10:00:00Z",
              },
            ]
          : [],
        next_offset: null,
      };
    } else if (path === "/api/images" && request.method() === "POST") {
      const data = await new Response(request.postDataBuffer(), {
        headers: { "content-type": await request.headerValue("content-type") },
      }).formData();
      state.uploads.push({
        id: data.get("id"),
        project_id: data.get("project_id"),
        file: data.get("image").name,
      });
      await uploadWait;
      if (options.loseUpload && state.uploads.length === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Upload response interrupted" } },
        });
      return route.fulfill({ status: 201, json: {} });
    } else if (path === "/api/batches/quote") {
      const input = request.postDataJSON();
      state.quotes.push(input);
      body = {
        images: input.image_ids.length,
        outputs: input.image_ids.length * input.outputs.length,
        estimated_credits: 18,
        reserved_credits: 24,
        allowance: { available_credits: options.insufficient ? 10 : 100 },
        can_generate: !options.insufficient,
        quote_fingerprint: "a".repeat(64),
      };
    } else if (path === "/api/batches" && request.method() === "POST") {
      state.creates.push(request.postDataJSON());
      return route.fulfill({
        status: 503,
        json: { error: { message: "Test stops before provider generation" } },
      });
    } else if (
      path === `/api/batches/${batch}` ||
      path === `/api/batches/${failed}`
    ) {
      state.detailReads++;
      const done = path.endsWith(batch);
      body = {
        batch: {
          name: done ? "Autumn <products>" : "Packaging collection",
          configuration: {
            outputs: [{ type: "detail", quality: "medium" }],
            instructions: "Keep the real packaging",
          },
        },
        status: done ? "completed" : "failed",
        counts: {
          total: 2,
          completed: done ? 2 : 0,
          failed: done ? 0 : 2,
          queued: 0,
          processing: 0,
        },
        items: [
          {
            outputs: [{ current: { status: done ? "completed" : "failed" } }],
            progress: { approved: done ? 1 : 0 },
          },
          {
            outputs: [{ current: { status: done ? "completed" : "failed" } }],
            progress: { approved: 0 },
          },
        ],
      };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(options.path || "/app/batches");
  return { ...state, state, releaseCap, releaseUpload };
}
async function nameBatch(page) {
  const config = page.locator(".bulk-setup");
  if (!(await config.evaluate((e) => e.open)))
    await config.locator("summary").first().click();
  await page.getByLabel("Batch name", { exact: true }).fill("Autumn products");
}
async function stage(page, incoming = [file()]) {
  await page.locator("input[name=files]").setInputFiles(incoming);
  await expect(
    page.locator(".bulk-file-status").filter({ hasText: /Reading/ }),
  ).toHaveCount(0);
}
const review = (page) =>
  page.getByRole("button", { name: /Upload and review allowance/ });

test("three functional zones use branded controls and remain inside the viewport", async ({
  page,
}) => {
  const { state } = await setup(page);
  await expect(
    page.getByRole("heading", { name: "Bulk processing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Source photographs", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Allowance & run" }),
  ).toBeVisible();
  await expect(page.locator("#batch-limit")).toContainText("5 sources / 50 MB");
  await expect(review(page)).toBeDisabled();
  await expect(page.locator(".bulk-actionbar")).toHaveCount(0);
  await expect(page.locator(".bulk-allowance #batch-review")).toBeVisible();
  await expect(page.locator("#batch-dropzone")).toHaveCSS(
    "border-top-style",
    "dashed",
  );
  await expect(page.locator("#batch-dropzone")).toHaveCSS(
    "border-top-width",
    "2px",
  );
  await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveCSS(
    "border-radius",
    "6px",
  );
  const toolbar = await page.locator(".bulk-queue-toolbar").boundingBox();
  const dropzone = await page.locator("#batch-dropzone").boundingBox();
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(dropzone.y);
  for (const selector of [
    "h1",
    "#batch-stage-heading",
    "#batch-allowance-heading",
    "#batch-history-heading",
    ".bulk-output-fieldset > legend",
  ])
    expect((await page.locator(selector).textContent()).trim()).not.toMatch(
      /\.$/,
    );
  await expect(review(page)).toHaveCSS("background-color", "rgb(20, 47, 62)");
  await expect(page.locator(".bulk-allowance")).toHaveCSS(
    "border-top-color",
    "rgb(244, 185, 121)",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  if (page.viewportSize().width > 1180) {
    const boxes = await Promise.all(
      [".bulk-setup", ".bulk-stage", ".bulk-allowance"].map((s) =>
        page.locator(s).boundingBox(),
      ),
    );
    expect(boxes[0].x + boxes[0].width).toBeLessThan(boxes[1].x);
    expect(boxes[1].x + boxes[1].width).toBeLessThan(boxes[2].x);
    const headers = await Promise.all(
      [
        ".bulk-setup > summary",
        ".bulk-stage > .bulk-panel-heading",
        ".bulk-allowance > .bulk-panel-heading",
      ].map((selector) => page.locator(selector).boundingBox()),
    );
    expect(
      Math.max(...headers.map((box) => box.y)) -
        Math.min(...headers.map((box) => box.y)),
    ).toBeLessThan(1);
    expect(new Set(headers.map((box) => box.height)).size).toBe(1);
    const nav = await page.locator(".sidebar").boundingBox(),
      active = await page
        .locator('.sidebar a[aria-current="page"]')
        .boundingBox();
    expect(nav.x + nav.width - active.x - active.width).toBeGreaterThanOrEqual(
      8,
    );
  }
  expect(state.uploads).toHaveLength(0);
  expect(state.creates).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("queue thumbnails report decoded dimensions, safely exclude individual files and support multi-selection", async ({
  page,
}) => {
  const { state } = await setup(page);
  await nameBatch(page);
  await stage(page, [file("one.webp"), file("two.webp")]);
  await expect(page.locator(".bulk-file-card")).toHaveCount(2);
  await expect(page.locator("#batch-dropzone .bulk-file-card")).toHaveCount(2);
  await expect(page.locator("#batch-empty")).toBeHidden();
  await expect(page.locator(".bulk-file-card img")).toHaveCount(2);
  await expect(page.locator(".bulk-file-meta").first()).toContainText(
    /\d+ × \d+ px/,
  );
  await page
    .getByRole("checkbox", { name: "Select one.webp", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Remove selected", exact: true })
    .click();
  await expect(page.locator(".bulk-file-card")).toHaveCount(1);
  await expect(page.locator(".bulk-file-name")).toHaveText("two.webp");
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove selected", exact: true })
    .click();
  await expect(page.locator("#batch-empty")).toBeVisible();
  expect(state.uploads).toHaveLength(0);
  expect(state.creates).toHaveLength(0);
});

test("supported output choices are quoted exactly, consent is mandatory and changed choices invalidate the review", async ({
  page,
}) => {
  const { state } = await setup(page);
  await nameBatch(page);
  await stage(page);
  await page.locator("[name=output][value=listing]").uncheck();
  await page.locator("[name=output][value=detail]").check();
  await page.locator("[name=output][value=wide]").check();
  await expect(page.locator("#batch-output-total")).toHaveText("2");
  await review(page).click();
  await expect(page.locator("#batch-quote")).toBeVisible();
  expect(state.quotes[0].outputs).toEqual([
    { type: "detail", quality: "low" },
    { type: "wide", quality: "low" },
  ]);
  await expect(
    page.getByRole("button", { name: "Confirm batch", exact: true }),
  ).toBeDisabled();
  expect(state.creates).toHaveLength(0);
  await page.locator("#batch-quote input").check();
  await expect(page.locator("#batch-quote")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm batch", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Test stops before provider generation",
  );
  await page
    .getByRole("button", { name: "Confirm batch", exact: true })
    .click();
  await expect.poll(() => state.creates.length).toBe(2);
  expect(state.creates[0].submission_key).toBe(state.creates[1].submission_key);
  await page
    .getByLabel("Output quality", { exact: true })
    .selectOption("medium");
  await expect(page.locator("#batch-quote")).toBeHidden();
  await review(page).click();
  await expect(page.locator("#batch-quote")).toBeVisible();
  expect(state.uploads).toHaveLength(1);
  expect(
    state.quotes[1].outputs.every((o) => o.quality === "medium"),
  ).toBeTruthy();
  expect(state.errors).toEqual([]);
});

test("invalid files and the real server limit block upload without inventing higher capacity", async ({
  page,
}) => {
  const { state } = await setup(page, { maxImages: 1 });
  await nameBatch(page);
  await stage(page, [file("one.webp"), file("two.webp")]);
  await expect(review(page)).toBeDisabled();
  await expect(page.locator("#batch-action-hint")).toContainText("1 sources");
  await page
    .getByRole("button", { name: "Remove two.webp", exact: true })
    .click();
  await expect(review(page)).toBeEnabled();
  await page.locator("input[name=files]").setInputFiles({
    name: "not-a-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid-image"),
  });
  await expect(page.locator(".bulk-file-error")).toContainText(
    "Image could not be read",
  );
  await expect(review(page)).toBeDisabled();
  expect(state.uploads).toHaveLength(0);
  expect(state.quotes).toHaveLength(0);
});

test("files selected while setup is loading survive initialization and are never uploaded early", async ({
  page,
}) => {
  const { state, releaseCap } = await setup(page, { delayCap: true });
  await stage(page, [file("early.webp")]);
  await expect(page.locator(".bulk-file-name")).toHaveText("early.webp");
  await expect(review(page)).toBeDisabled();
  expect(state.uploads).toHaveLength(0);
  releaseCap();
  await nameBatch(page);
  await expect(review(page)).toBeEnabled();
  await review(page).click();
  await expect(page.locator("#batch-quote")).toBeVisible();
  expect(state.uploads).toHaveLength(1);
});

test("an interrupted upload retries its stable image ID and freezes the reviewed project while uploading", async ({
  page,
}) => {
  const { state, releaseUpload } = await setup(page, {
    loseUpload: true,
    delayUpload: true,
  });
  await nameBatch(page);
  await stage(page);
  await review(page).click();
  await expect.poll(() => state.uploads.length).toBe(1);
  await expect(page.getByLabel("Project", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove product.webp", exact: true }),
  ).toBeDisabled();
  releaseUpload();
  await expect(page.getByRole("alert")).toContainText(
    "Upload response interrupted",
  );
  await expect(review(page)).toBeEnabled();
  await review(page).click();
  await expect(page.locator("#batch-quote")).toBeVisible();
  expect(state.uploads[0].id).toBe(state.uploads[1].id);
  expect(state.quotes).toHaveLength(1);
  expect(state.creates).toHaveLength(0);
});

test("insufficient verified allowance and unavailable services never offer a generation action", async ({
  page,
}) => {
  const { state } = await setup(page, { insufficient: true });
  await nameBatch(page);
  await stage(page);
  await review(page).click();
  await expect(page.locator("#batch-quote")).toContainText("18");
  await expect(page.locator("#batch-quote")).toContainText("24");
  await expect(page.locator("#batch-quote")).toContainText("10");
  await expect(page.locator("#batch-run-state")).toHaveText(
    "More allowance needed",
  );
  await page.locator("#batch-quote input").check();
  await expect(
    page.getByRole("button", { name: "Confirm batch", exact: true }),
  ).toBeDisabled();
  expect(state.creates).toHaveLength(0);
});

test("batch history shows persisted run summaries, approved-only downloads and safe setup reuse", async ({
  page,
}) => {
  const { state } = await setup(page, { history: true });
  const row = page.locator("#batch-history tbody tr").first(),
    bad = page.locator("#batch-history tbody tr").nth(1);
  await expect(row.locator(".bulk-history-status")).toHaveText("completed");
  await expect(bad.locator(".bulk-history-status")).toHaveText("failed");
  await expect(row).toContainText("Studio");
  await expect(row).toContainText("2 / 2 saved");
  await expect(row).toContainText("1 approved");
  await expect(
    row.getByRole("link", { name: "Approved ZIP ↓" }),
  ).toHaveAttribute("href", `/api/batches/${batch}/download`);
  await expect(bad.getByRole("link", { name: "Approved ZIP ↓" })).toHaveCount(
    0,
  );
  await expect(
    row.getByRole("link", { name: "View batch ↗" }),
  ).toHaveAttribute("href", `/app/batches/${batch}`);
  await expect(row.locator(`a[href="/app/projects/${project}"]`)).toBeVisible();
  await row.getByRole("button", { name: "Reuse setup" }).click();
  await expect(page.getByLabel("Batch name", { exact: true })).toHaveValue(
    "Autumn <products> copy",
  );
  await expect(page.getByLabel("Output quality", { exact: true })).toHaveValue(
    "medium",
  );
  await expect(page.locator("[name=output][value=detail]")).toBeChecked();
  await expect(page.locator("[name=output][value=listing]")).not.toBeChecked();
  await expect(
    page.getByRole("status").filter({ hasText: "Setup copied" }),
  ).toBeVisible();
  expect(state.uploads).toHaveLength(0);
  expect(state.quotes).toHaveLength(0);
  expect(state.creates).toHaveLength(0);
  expect(state.detailReads).toBe(2);
  expect(state.errors).toEqual([]);
});

test("history loading failure is explicit and refreshing recovers without a fake empty state", async ({
  page,
}) => {
  const { state } = await setup(page, { historyError: true, history: true });
  await expect(page.locator("#batch-history")).toContainText(
    "Saved batches could not load",
  );
  await expect(
    page.getByText("No saved batches yet", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(page.locator("#batch-history tbody tr")).toHaveCount(2);
  await expect(page.locator(".bulk-history-status")).toHaveCount(2);
  expect(state.historyReads).toBe(2);
});

test("folder drops traverse directory entries and stage source images without any provider calls", async ({
  page,
}) => {
  const { state } = await setup(page);
  await page.evaluate(
    (bytes) => {
      const blob = new Uint8Array(bytes),
        a = new File([blob], "front.webp", { type: "image/webp" }),
        b = new File([blob], "detail.webp", { type: "image/webp" });
      const entry = (f) => ({
        isFile: true,
        isDirectory: false,
        file: (resolve) => resolve(f),
      });
      const directory = {
        isDirectory: true,
        isFile: false,
        createReader() {
          let read = false;
          return {
            readEntries(resolve) {
              resolve(read ? [] : [entry(a), entry(b)]);
              read = true;
            },
          };
        },
      };
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { items: [{ webkitGetAsEntry: () => directory }], files: [a] },
      });
      document.querySelector("#batch-dropzone").dispatchEvent(event);
    },
    [...photo],
  );
  await expect(page.locator(".bulk-file-card")).toHaveCount(2);
  await expect(
    page.locator(".bulk-file-status").filter({ hasText: "Ready" }),
  ).toHaveCount(2);
  expect(state.uploads).toHaveLength(0);
  expect(state.creates).toHaveLength(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("disabled generation still permits local staging and accurate history with a route to project creation", async ({
  page,
}) => {
  const { state } = await setup(page, {
    unavailable: true,
    noProjects: true,
    history: true,
  });
  await stage(page);
  await expect(page.locator("#batch-notice")).toContainText(
    "awaiting activation",
  );
  await expect(page.locator("#batch-run-state")).toHaveText(
    "Generation unavailable",
  );
  await expect(review(page)).toBeDisabled();
  const config = page.locator(".bulk-setup");
  if (!(await config.evaluate((e) => e.open)))
    await config.locator("summary").first().click();
  await expect(
    page.getByRole("link", { name: "Create a project ↗" }),
  ).toHaveAttribute("href", "/app");
  await expect(page.locator(".bulk-history-status")).toHaveCount(2);
  expect(state.uploads).toHaveLength(0);
  expect(state.creates).toHaveLength(0);
});

test("native folder selection stages supported files and preserves their names", async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "sonko-bulk-folder-"));
  try {
    await writeFile(join(dir, "front.webp"), photo);
    await writeFile(join(dir, "detail.webp"), photo);
    const { state } = await setup(page);
    await page.locator("input[name=folder]").setInputFiles(dir);
    await expect(page.locator(".bulk-file-card")).toHaveCount(2);
    await expect(
      page.locator(".bulk-file-status").filter({ hasText: "Ready" }),
    ).toHaveCount(2);
    await expect(page.locator(".bulk-file-name")).toHaveText([
      "detail.webp",
      "front.webp",
    ]);
    expect(state.uploads).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saved Brand Studio direction is passed through the existing batch quote and changes require a new review", async ({
  page,
}) => {
  const { state } = await setup(page, { brand: true });
  await nameBatch(page);
  await page
    .getByLabel("Saved brand profile", { exact: true })
    .selectOption(project);
  await page
    .getByText("Preview & adjust selected brand", { exact: true })
    .click();
  await expect(page.locator(".brand-preview")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await stage(page);
  await review(page).click();
  await expect(page.locator("#batch-quote")).toBeVisible();
  expect(state.quotes[0].brand.profile_id).toBe(project);
  expect(state.quotes[0].brand.profile_revision).toBe(3);
  await page
    .getByLabel("Saved brand profile", { exact: true })
    .selectOption("");
  await expect(page.locator("#batch-quote")).toBeHidden();
  await review(page).click();
  await expect(page.locator("#batch-quote")).toBeVisible();
  expect(state.quotes[1].brand).toBeUndefined();
  expect(state.uploads).toHaveLength(1);
  expect(state.creates).toHaveLength(0);
  expect(state.errors).toEqual([]);
});


test("project directory bulk links preselect only an existing project and never start work", async ({page}) => {
 const target="99999999-9999-4999-8999-999999999999";
 const f=await setup(page,{path:`/app/batches?project=${target}`,projectChoices:[{id:project,name:"First collection"},{id:target,name:"Selected campaign"}]});
 await expect(page.locator('select[name="project"]')).toHaveValue(target);
 expect(f.state.uploads).toEqual([]);
});

test('cross-page batch history links land on the history section after asynchronous page loading', async ({page}) => {
 await setup(page,{path:'/app/batches#batch-history-section'});
 await expect(page.locator('#batch-history-heading')).toBeInViewport();
});
