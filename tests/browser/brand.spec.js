import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const profileId = "11111111-1111-4111-8111-111111111111",
  presetId = "22222222-2222-4222-8222-222222222222",
  project = "33333333-3333-4333-8333-333333333333",
  image = "44444444-4444-4444-8444-444444444444",
  job = "55555555-5555-4555-8555-555555555555",
  asset = "66666666-6666-4666-8666-666666666666",
  pack = "77777777-7777-4777-8777-777777777777";
const settings = {
  primary_color: "#243F37",
  secondary_color: "#F3F1EB",
  accent_color: "#D5A66D",
  background_style: "solid",
  background_color: "#E8E0CE",
  theme: "warm",
  image_style: "realistic",
  canvas: "portrait",
  framing: "full_product",
  spacing: "balanced",
  restrictions: "No invented accessories",
  instructions: "Natural morning light",
  logo_asset_id: null,
  logo_placement: "none",
  logo_align: "right",
};
async function fixture(page, { empty = false, failSave = false } = {}) {
  const photo = await readFile(
    new URL("../../public/images/footwear-small.webp", import.meta.url),
  );
  const state = {
    profiles: empty
      ? []
      : [
          {
            id: profileId,
            name: "Evergreen",
            description: "Independent goods",
            revision: 1,
            settings: { ...settings },
          },
        ],
    presets: [
      {
        id: presetId,
        profile_id: profileId,
        name: "Clean listings",
        purpose: "listing",
        revision: 2,
        settings: { theme: "restrained", spacing: "generous" },
      },
    ],
    assets: [],
    jobs: [],
    quotes: [],
    mutations: [],
  };
  await page.route("**/app/**", async (route) =>
    route.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    let body = {};
    const fail = (status, message) =>
      route.fulfill({
        status,
        json: { error: { message, code: "brand_conflict" } },
      });
    if (path === "/api/session")
      body = { profile: { display_name: "Owner", audience: "ecommerce" } };
    else if (path === "/api/brands/capabilities") body = { available: true };
    else if (path === "/api/brands" && method === "GET")
      body = { profiles: state.profiles };
    else if (path === "/api/brands/assets" && method === "GET")
      body = { assets: state.assets };
    else if (path === "/api/brands/assets" && method === "POST") {
      state.assets.push({
        id: asset,
        name: "Evergreen logo",
        kind: "logo",
        width: 128,
        height: 80,
      });
      body = { asset: { id: asset } };
    } else if (path.endsWith("/content"))
      return route.fulfill({ body: photo, contentType: "image/webp" });
    else if (path === "/api/brands" && method === "POST") {
      const v = route.request().postDataJSON();
      state.mutations.push(v);
      if (failSave)
        return fail(409, "These brand settings changed. Reload and review.");
      if (v.action === "duplicate") {
        const source = state.profiles.find((p) => p.id === v.parent);
        const copy = {
          ...structuredClone(source),
          id: v.id,
          name: `${source.name} copy`,
          revision: 1,
        };
        state.profiles.push(copy);
        body = { profile: copy };
      } else if (v.action === "delete") {
        state.profiles = state.profiles.filter((p) => p.id !== v.id);
        body = { deleted: true };
      } else {
        const old = state.profiles.find((p) => p.id === v.id);
        const saved = {
          id: v.id,
          ...v.data,
          revision: (old?.revision ?? 0) + 1,
        };
        state.profiles = state.profiles.filter((p) => p.id !== v.id);
        state.profiles.push(saved);
        body = { profile: saved };
      }
    } else if (/^\/api\/brands\/[^/]+\/presets$/.test(path)) {
      const v = route.request().postDataJSON();
      state.mutations.push(v);
      if (v.action === "delete")
        state.presets = state.presets.filter((p) => p.id !== v.id);
      else {
        const old = state.presets.find((p) => p.id === v.id);
        state.presets = state.presets.filter((p) => p.id !== v.id);
        state.presets.push({
          id: v.id,
          profile_id: path.split("/")[3],
          ...v.data,
          revision: (old?.revision ?? 0) + 1,
        });
      }
      body = { preset: state.presets.at(-1) };
    } else if (/^\/api\/brands\/[^/]+$/.test(path)) {
      const id = path.split("/").pop();
      body = {
        profile: state.profiles.find((p) => p.id === id),
        presets: state.presets.filter((p) => p.profile_id === id),
      };
    } else if (path === `/api/images/${image}`)
      body = {
        image: {
          id: image,
          project_id: project,
          filename: "Original.webp",
          role: "original",
          status: "ready",
          audience: "ecommerce",
        },
      };
    else if (path === "/api/images")
      body = {
        images: [
          {
            id: image,
            filename: "Original.webp",
            role: "original",
            status: "ready",
          },
        ],
      };
    else if (path === "/api/processing/capabilities")
      body = {
        enabled: true,
        qualities: ["low", "medium", "high"],
        default_quality: "high",
        daily_limit: 5,
        product_quality_available: true,
      };
    else if (path === "/api/jobs" && method === "POST") {
      state.jobs.push(route.request().postDataJSON());
      return fail(503, "Test stops before any paid provider request.");
    } else if (path === "/api/packs/capabilities")
      body = {
        enabled: true,
        max_outputs: 5,
        qualities: ["low", "medium", "high"],
        default_quality: "high",
        outputs: {
          listing: {
            name: "Clean Listing Image",
            size: "1024x1024",
            aspect: "1:1",
            creative: false,
            description: "Preserve the real product.",
          },
          wide: {
            name: "Wide Promotional Image",
            size: "1536x1024",
            aspect: "3:2",
            creative: true,
            description: "A creative setting.",
          },
        },
      };
    else if (path === "/api/packs/quote") {
      const v = route.request().postDataJSON();
      state.quotes.push(v);
      body = {
        outputs: v.outputs.map((o) => ({
          ...o,
          name: o.type,
          size: o.type === "wide" ? "1536x1024" : "1024x1024",
          estimated_credits: 20,
          reserved_credits: 30,
        })),
        estimated_credits: 40,
        reserved_credits: 60,
        allowance: { available_credits: 1000 },
        can_generate: true,
        quote_fingerprint: "a".repeat(64),
      };
    } else if (path === `/api/jobs/${job}`)
      body = {
        job: {
          id: job,
          project_id: project,
          input_image_id: image,
          output_image_id: image,
          mode: "product",
          status: "completed",
          settings: {
            brand_snapshot: {
              profile_name: "Archived identity",
              profile_revision: 3,
              preset_name: "Old preset",
              preset_revision: 2,
              settings,
            },
          },
          quality_state: "completed",
          user_decision: "pending",
          quality_report: { checks: [], status: "needs_review" },
          quality_retry_limit: 2,
          quality_retry_used: 0,
          output_size: "1024x1024",
          attempts: 1,
          created_at: "2026-10-28T00:00:00Z",
        },
      };
    return route.fulfill({ json: body });
  });
  return state;
}
test("Brand Studio creates a persisted identity, previews colors and saves sparse reusable presets", async ({
  page,
}) => {
  const s = await fixture(page, { empty: true });
  await page.goto("/app/brands");
  await page.getByLabel("Brand name", { exact: true }).fill("Aster Goods");
  await page.getByLabel("Background color", { exact: true }).fill("#abcdef");
  await page.getByLabel("Background", { exact: true }).selectOption("solid");
  await expect(page.locator(".brand-preview-canvas")).toHaveCSS(
    "background-color",
    "rgb(171, 205, 239)",
  );
  await page
    .getByRole("button", { name: "Save brand profile", exact: true })
    .click();
  await expect(
    page.getByText("Brand profile saved.", { exact: true }),
  ).toBeVisible();
  expect(s.profiles[0].settings.background_color).toBe("#abcdef");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `/tmp/phase5-brand-${test.info().project.name}.png`,
  });
  await page.getByRole("button", { name: "Create reusable preset" }).click();
  await page.getByLabel("Preset name", { exact: true }).fill("Soft shop");
  await page.getByLabel("Override visual theme", { exact: true }).check();
  await page
    .locator(".brand-presets [data-setting=theme]")
    .selectOption("natural");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(page.getByText("Soft shop", { exact: true })).toBeVisible();
  expect(s.presets.at(-1).settings).toEqual({ theme: "natural" });
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => window.innerWidth),
  );
});
test("Saved profiles can be edited, duplicated and deleted without silently changing the original", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/app/brands");
  await page.getByRole("button", { name: "Evergreen", exact: true }).click();
  await page.getByLabel("Brand name", { exact: true }).fill("Evergreen Studio");
  await page.getByRole("button", { name: "Save profile changes" }).click();
  await expect(
    page.getByRole("button", { name: "Evergreen Studio", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Duplicate profile" }).click();
  await expect(page.getByLabel("Brand name", { exact: true })).toHaveValue(
    "Evergreen Studio copy",
  );
  expect(s.profiles).toHaveLength(2);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete profile", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Evergreen Studio copy", exact: true }),
  ).toHaveCount(0);
  expect(s.profiles).toHaveLength(1);
  expect(s.profiles[0].revision).toBe(2);
});
test("Product editor retains explicit job choices and preset overrides while excluding brands from portrait mode", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto(`/app/edit/${image}`);
  await page.locator("[name=framing]").selectOption("landscape");
  await page.getByLabel("Saved brand profile").selectOption(profileId);
  await expect(page.getByLabel("Reusable preset")).toContainText(
    "Clean listings",
  );
  await expect(page.locator("[name=framing]")).toHaveValue("landscape");
  await page.getByLabel("Override subject spacing").check();
  await page
    .locator(".brand-picker [data-setting=spacing]")
    .selectOption("tight");
  await page.getByLabel("Reusable preset").selectOption(presetId);
  await expect(
    page.locator(".brand-picker [data-setting=spacing]"),
  ).toHaveValue("tight");
  await page.locator("[name=provider_consent]").check();
  await page
    .getByRole("button", { name: "Generate edited photograph", exact: true })
    .click();
  await expect(
    page.getByText("Test stops before any paid provider request."),
  ).toBeVisible();
  expect(s.jobs[0].brand).toMatchObject({
    profile_id: profileId,
    preset_id: presetId,
    profile_revision: 1,
    preset_revision: 2,
    overrides: { spacing: "tight" },
  });
  expect(s.jobs[0].framing).toBe("landscape");
  await page.getByLabel("Enhancement mode").selectOption("portrait");
  await expect(page.locator(".brand-picker")).toBeHidden();
  await page
    .getByRole("button", { name: "Generate edited photograph", exact: true })
    .click();
  await expect.poll(() => s.jobs.length).toBe(2);
  expect(s.jobs[1].brand).toBeUndefined();
});
test("Pack planning applies a saved brand and explicit overrides and invalidates the quote when settings change", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto(`/app/packs/new/${image}`);
  await page.getByLabel("Saved brand profile").selectOption(profileId);
  await expect(page.getByLabel("Reusable preset")).toContainText(
    "Clean listings",
  );
  await page.getByLabel("Reusable preset").selectOption(presetId);
  await page.getByRole("button", { name: "Review pack plan" }).click();
  await expect(page.locator("#pack-quote")).toBeVisible();
  expect(s.quotes[0].brand.preset_id).toBe(presetId);
  await page.getByLabel("Override visual theme").check();
  await expect(page.locator("#pack-quote")).toBeHidden();
  await page.locator(".brand-picker [data-setting=theme]").selectOption("cool");
  await page.getByRole("button", { name: "Review pack plan" }).click();
  expect(s.quotes[1].brand.overrides.theme).toBe("cool");
});
test("Archived job records show recorded profile and preset revisions independently of current profiles", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`/app/edits/${job}`);
  await expect(
    page.getByText(
      "Brand: Archived identity · revision 3 / Old preset · revision 2",
      { exact: true },
    ),
  ).toBeVisible();
  await page.locator(".brand-history summary").click();
  await expect(
    page.getByText(
      "These settings were recorded with this job. Later profile edits or deletion do not change this record.",
    ),
  ).toBeVisible();
});
test("Save conflicts preserve the unsaved form and asset uploads use the private library", async ({
  page,
}) => {
  const s = await fixture(page, { failSave: true });
  await page.goto("/app/brands");
  await page.getByRole("button", { name: "Evergreen", exact: true }).click();
  await page.getByLabel("Brand name", { exact: true }).fill("Unsaved draft");
  await page.getByRole("button", { name: "Save profile changes" }).click();
  await expect(
    page.getByText("These brand settings changed. Reload and review."),
  ).toBeVisible();
  await expect(page.getByLabel("Brand name", { exact: true })).toHaveValue(
    "Unsaved draft",
  );
  await page.locator("#brand-upload input[name=name]").fill("Evergreen logo");
  await page.locator("#brand-upload input[type=file]").setInputFiles({
    name: "logo.webp",
    mimeType: "image/webp",
    buffer: await readFile(
      new URL("../../public/images/footwear-small.webp", import.meta.url),
    ),
  });
  await page.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(page.locator(".brand-asset")).toContainText("Evergreen logo");
  expect(s.assets).toHaveLength(1);
});
