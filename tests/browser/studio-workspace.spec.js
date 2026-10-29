import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const id = "11111111-1111-4111-8111-111111111111";
async function fixture(page, { loseFirstUpload = false } = {}) {
  const photo = await readFile(
    new URL("../../public/images/footwear-small.webp", import.meta.url),
  );
  const state = {
    profiles: [
      {
        id,
        name: "Evergreen",
        description: "Saved visual identity",
        revision: 1,
        settings: {
          primary_color: "#243F37",
          secondary_color: "#F3F1EB",
          accent_color: "#D5A66D",
          background_color: "#F3F1EB",
        },
      },
    ],
    assets: [],
    uploads: [],
    saves: [],
    paidRequests: 0,
  };
  let lost = false;
  await page.route(/\/app(?:\/.*)?$/, async (route) =>
    route.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let body = {};
    if (path === "/api/session")
      body = {
        profile: { display_name: "Brand owner", audience: "ecommerce" },
      };
    else if (path === "/api/brands/capabilities") body = { available: true };
    else if (path === "/api/brands" && request.method() === "GET")
      body = { profiles: state.profiles };
    else if (path === "/api/brands" && request.method() === "POST") {
      const v = request.postDataJSON();
      state.saves.push(v);
      const profile = { id: v.id, revision: (v.revision ?? 0) + 1, ...v.data };
      state.profiles = state.profiles.filter((p) => p.id !== profile.id);
      state.profiles.push(profile);
      body = { profile };
    } else if (path === "/api/brands/assets" && request.method() === "GET")
      body = { assets: state.assets };
    else if (path === "/api/brands/assets" && request.method() === "POST") {
      const data = await new Response(request.postDataBuffer(), {
        headers: { "content-type": await request.headerValue("content-type") },
      }).formData();
      const asset = {
        id: data.get("id"),
        name: data.get("name"),
        kind: data.get("kind"),
        width: 128,
        height: 80,
        byte_size: data.get("asset").size,
        status: "ready",
      };
      state.uploads.push({ ...asset });
      if (!state.assets.some((item) => item.id === asset.id))
        state.assets.push(asset);
      if (loseFirstUpload && !lost) {
        lost = true;
        return route.fulfill({
          status: 503,
          json: { error: { message: "Response lost. Retry this upload." } },
        });
      }
      body = { asset };
    } else if (path.endsWith("/content"))
      return route.fulfill({ body: photo, contentType: "image/webp" });
    else if (path.startsWith("/api/brands/"))
      body = {
        profile: state.profiles.find((p) => p.id === path.split("/").pop()),
        presets: [],
      };
    else {
      state.paidRequests++;
      return route.fulfill({
        status: 404,
        json: { error: { message: "Unexpected API request" } },
      });
    }
    await route.fulfill({ json: body });
  });
  return { state, photo };
}
test("visual stage, exact HEX entry and footer anchors persist supported settings without spending units", async ({
  page,
}, info) => {
  const { state } = await fixture(page);
  await page.goto("/app/brands");
  await page.getByLabel("Brand name", { exact: true }).fill("Aster Studio");
  await expect(page.locator("#studio-save")).toHaveCSS(
    "background-color",
    "rgb(20, 47, 62)",
  );
  await page.getByLabel("Primary color HEX", { exact: true }).fill("#123456");
  await expect(page.getByLabel("Primary color", { exact: true })).toHaveValue(
    "#123456",
  );
  await page.getByLabel("Background", { exact: true }).selectOption("solid");
  await page
    .getByLabel("Background color HEX", { exact: true })
    .fill("#d9e4cc");
  await expect(page.locator(".studio-stage")).toHaveCSS(
    "background-color",
    "rgb(217, 228, 204)",
  );
  await page.getByRole("button", { name: "Daylight", exact: true }).click();
  await expect(page.locator(".studio-stage")).toHaveAttribute(
    "data-light",
    "daylight",
  );
  await page.getByLabel("Show guides", { exact: true }).uncheck();
  await expect(page.locator(".studio-stage")).toHaveAttribute(
    "data-guides",
    "false",
  );
  await page.getByText("Brand rules & logo", { exact: true }).click();
  await page
    .getByRole("group", { name: "Logo footer alignment" })
    .getByRole("button", { name: "Left", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save brand profile", exact: true })
    .click();
  await expect(page.locator("#brand-notice")).toContainText("saved");
  expect(state.saves[0].data.settings.primary_color).toBe("#123456");
  expect(state.saves[0].data.settings.logo_align).toBe("left");
  expect(state.saves[0].data.settings).not.toHaveProperty("light");
  expect(state.paidRequests).toBe(0);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `test-results/studio-workspace-${info.project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: `test-results/studio-viewport-${info.project.name}.png`,
  });
  await page.locator(".studio-preview").evaluate((el) =>
    window.scrollTo({
      top: el.getBoundingClientRect().top + scrollY - 20,
      behavior: "instant",
    }),
  );
  await page.locator(".studio-preview").screenshot({
    path: `test-results/studio-preview-${info.project.name}.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("brand switching protects unsaved edits and restores the selected saved profile", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/app/brands");
  await page.getByLabel("Brand name", { exact: true }).fill("Unsaved draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("Switch brand profile").selectOption(id);
  await expect(page.getByLabel("Brand name", { exact: true })).toHaveValue(
    "Unsaved draft",
  );
  await expect(page.getByLabel("Switch brand profile")).toHaveValue("");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Switch brand profile").selectOption(id);
  await expect(page.getByLabel("Brand name", { exact: true })).toHaveValue(
    "Evergreen",
  );
  await expect(page.locator("#studio-edit-state")).toContainText(
    "Saved revision",
  );
});
test("multi-file queue validates unsupported assets and saves each private asset independently", async ({
  page,
}) => {
  const { state, photo } = await fixture(page);
  await page.goto("/app/brands");
  await page.locator("#brand-upload input[type=file]").setInputFiles({
    name: "vector.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.locator("#brand-upload .notice")).toContainText("SVG");
  expect(state.uploads).toHaveLength(0);
  await page.locator("#brand-upload input[type=file]").setInputFiles([
    { name: "primary.webp", mimeType: "image/webp", buffer: photo },
    { name: "reference.webp", mimeType: "image/webp", buffer: photo },
  ]);
  await expect(page.locator(".studio-queued-asset")).toHaveCount(2);
  await page
    .locator(".studio-queued-asset")
    .last()
    .getByLabel("Asset type")
    .selectOption("reference");
  await page
    .getByRole("button", { name: "Upload assets", exact: true })
    .click();
  await expect(page.locator("#brand-upload .notice")).toContainText(
    "2 assets saved privately",
  );
  expect(state.assets).toHaveLength(2);
  expect(state.assets[1].kind).toBe("reference");
  await expect(page.locator(".brand-asset")).toHaveCount(2);
  expect(state.uploads[0].id).not.toBe(state.uploads[1].id);
  expect(state.paidRequests).toBe(0);
});
test("an uncertain upload response retries the same asset ID and does not resend successful files", async ({
  page,
}) => {
  const { state, photo } = await fixture(page, { loseFirstUpload: true });
  await page.goto("/app/brands");
  await page.locator("#brand-upload input[type=file]").setInputFiles([
    { name: "logo.webp", mimeType: "image/webp", buffer: photo },
    { name: "reference.webp", mimeType: "image/webp", buffer: photo },
  ]);
  await page
    .getByRole("button", { name: "Upload assets", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry unsaved assets" }),
  ).toBeVisible();
  expect(state.uploads).toHaveLength(2);
  await page.getByRole("button", { name: "Retry unsaved assets" }).click();
  await expect(page.locator("#brand-upload .notice")).toContainText(
    "2 assets saved privately",
  );
  expect(state.uploads).toHaveLength(3);
  expect(state.uploads[2].id).toBe(state.uploads[0].id);
  expect(state.assets).toHaveLength(2);
});

test("files selected before brand metadata finishes loading remain in the queue", async ({
  page,
}) => {
  const { state, photo } = await fixture(page);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/brands/assets", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await pending;
    return route.fulfill({ json: { assets: state.assets } });
  });
  await page.goto("/app/brands");
  await page.locator("#brand-upload input[type=file]").setInputFiles({
    name: "early-logo.webp",
    mimeType: "image/webp",
    buffer: photo,
  });
  await expect(page.locator(".studio-queued-asset")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Upload asset", exact: true }),
  ).toBeDisabled();
  expect(state.uploads).toHaveLength(0);
  release();
  await expect(
    page.getByRole("button", { name: "Upload asset", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(page.locator("#brand-upload .notice")).toContainText(
    "Asset saved privately",
  );
  expect(state.assets).toHaveLength(1);
});

test("removed logos remain explicit in saved settings without a broken staging image", async ({
  page,
}) => {
  const { state } = await fixture(page);
  const missing = "99999999-9999-4999-8999-999999999999";
  state.profiles[0].settings.logo_asset_id = missing;
  state.profiles[0].settings.logo_placement = "footer";
  await page.goto("/app/brands");
  await page.getByLabel("Switch brand profile").selectOption(id);
  await expect(
    page.locator(".studio-preview .brand-preview-footer"),
  ).toContainText("Logo unavailable");
  await expect(
    page.locator(".studio-preview .brand-preview-footer img"),
  ).toHaveCount(0);
  await expect(page.locator("[data-setting=logo_asset_id]")).toHaveValue(
    missing,
  );
  expect(state.paidRequests).toBe(0);
});
