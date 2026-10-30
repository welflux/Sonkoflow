import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

const projectId = "11111111-1111-4111-8111-111111111111";
const imageId = "22222222-2222-4222-8222-222222222222";
async function workspaceFixture(
  page,
  { empty = false, hasImage = false } = {},
) {
  const photograph = await readFile(
    new URL("../../public/images/footwear-small.webp", import.meta.url),
  );
  const state = {
    projects: empty
      ? []
      : [
          {
            id: projectId,
            name: "Studio collection",
            audience: "ecommerce",
            created_at: "2026-10-28T00:00:00Z",
          },
        ],
    images: hasImage
      ? [
          {
            id: imageId,
            filename: "collection.webp",
            width: 1536,
            height: 1024,
            byte_size: 12345,
            status: "ready",
          },
        ]
      : [],
    uploaded: false,
    saved: null,
  };
  // These are browser presentation fixtures, not live-service authentication tests.
  await page.route(/\/app(?:\/.*)?$/, async (route) => {
    const response = await page.request.get("/account/signin");
    await route.fulfill({ response });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body = {};
    let status = 200;
    if (path === "/api/processing/capabilities")
      body = { enabled: false, history_available: false };
    else if (path === "/api/session")
      body = {
        profile: { display_name: "Creative owner", audience: "ecommerce" },
      };
    else if (path === "/api/projects/directory") {
      body = { projects: state.projects.map(p => ({...p, archived:false, metadata_available:true, asset_count:0, last_activity_at:p.created_at, last_operation:null})) };
    } else if (path === "/api/projects") {
      if (request.method() === "POST")
        state.projects.push({
          id: projectId,
          ...request.postDataJSON(),
          created_at: new Date().toISOString(),
        });
      body = { projects: state.projects };
    } else if (path === "/api/profile") {
      state.saved = request.postDataJSON();
      body = { profile: state.saved };
    } else if (path === "/api/images") {
      if (request.method() === "POST") {
        state.uploaded = true;
        state.images = [
          {
            id: imageId,
            filename: "collection.webp",
            width: 1536,
            height: 1024,
            byte_size: 12345,
            status: "ready",
          },
        ];
        status = 201;
      }
      body = { images: state.images };
    } else if (path === `/api/images/${imageId}/content`) {
      await route.fulfill({
        status: 200,
        contentType: "image/webp",
        body: photograph,
      });
      return;
    } else if (
      path === `/api/images/${imageId}` &&
      request.method() === "DELETE"
    )
      state.images = [];
    else {
      await route.abort();
      return;
    }
    await route.fulfill({ status, json: body });
  });
  return state;
}

test("empty projects, create flow, navigation, and long names remain usable", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await workspaceFixture(page, { empty: true });
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Create your first project" }),
  ).toBeVisible();
  await page.locator("#project-new").click();
  await page.getByLabel("Project name").fill("Autumn collection");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("link", { name: "Autumn collection" }),
  ).toBeVisible();
  expect(state.projects).toHaveLength(1);
  await page.screenshot({
    path: `test-results/workspace-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Autumn collection" }).click();
  await expect(
    page.getByRole("heading", { name: "Autumn collection" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A clear canvas." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test("upload selection, real drop handling, preview, download, and deletion controls", async ({
  page,
}, testInfo) => {
  const state = await workspaceFixture(page);
  await page.goto(`/app/projects/${projectId}`);
  // Drop a local browser-created image; no real user storage is touched.
  const transfer = await page.evaluateHandle(async () => {
    const blob = await (await fetch("/images/footwear-small.webp")).blob();
    const data = new DataTransfer();
    data.items.add(new File([blob], "collection.webp", { type: "image/webp" }));
    return data;
  });
  await page
    .locator("#dropzone")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator("#selected-name")).toHaveText("collection.webp");
  await expect(page.locator("#upload-preview img")).toBeVisible();
  await page
    .getByRole("button", { name: "Upload photograph", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview collection.webp" }),
  ).toBeVisible();
  expect(state.uploaded).toBeTruthy();
  await page.getByRole("button", { name: "Preview collection.webp" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "collection.webp" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Download WebP" }),
  ).toHaveAttribute("href", `/api/images/${imageId}/content?download=1`);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview collection.webp" }),
  ).toBeFocused();
  await page.screenshot({
    path: `test-results/gallery-${testInfo.project.name}.png`,
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clear canvas." }),
  ).toBeVisible();
});

test("invalid uploads stay local and malicious filenames render as text", async ({
  page,
}) => {
  const state = await workspaceFixture(page, { hasImage: true });
  state.images[0].filename =
    "<img src=x onerror=alert(1)> very-long-photograph-name-".repeat(3);
  await page.goto(`/app/projects/${projectId}`);
  await page.getByLabel("Photograph", { exact: true }).setInputFiles({
    name: "script.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Choose a JPEG, PNG, or WebP",
  );
  expect(state.uploaded).toBeFalsy();
  await expect(page.locator(".image-info h3")).toHaveText(
    state.images[0].filename,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("profile save and account screens use the shared design system", async ({
  page,
}, testInfo) => {
  const state = await workspaceFixture(page);
  await page.goto("/app/profile");
  await expect(page.getByLabel("Display name")).toHaveValue("Creative owner");
  await page.getByLabel("Display name").fill("New name");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your profile has been saved",
  );
  expect(state.saved.display_name).toBe("New name");
  await page.goto("/account/signin");
  await page.screenshot({
    path: `test-results/account-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await expect(page.locator("body")).toHaveCSS("font-family", /Inter/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

for (const width of [320, 768, 1024]) {
  test(`dashboard remains readable and navigable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await workspaceFixture(page, { empty: true });
    await page.goto('/app');
    await expect(page.locator('.workspace-content h1')).toHaveCSS('font-size', width <= 600 ? '28px' : '30px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const nav = page.getByRole('navigation', { name: 'Workspace' });
    const navBox = await nav.boundingBox();
    expect(navBox.height).toBeLessThan(110);
    const profile = nav.getByRole('link', { name: 'Account profile' });
    await profile.scrollIntoViewIfNeeded();
    await profile.click();
    await expect(page.locator('.workspace-content h1')).toHaveCSS('font-size', width <= 600 ? '28px' : '30px');
    await expect(page.getByLabel('Display name')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByLabel('Display name').fill('Mobile and tablet owner');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByRole('status')).toContainText('Your profile has been saved');
  });
}

test('cross-page upload links reach the photograph dropzone after asynchronous project loading', async ({page}) => {
 await workspaceFixture(page);
 await page.goto(`/app/projects/${projectId}#dropzone`);
 await expect(page.locator('#dropzone')).toBeInViewport();
});
