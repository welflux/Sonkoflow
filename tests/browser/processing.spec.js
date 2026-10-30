import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
const project = "11111111-1111-4111-8111-111111111111",
  image = "22222222-2222-4222-8222-222222222222",
  job = "33333333-3333-4333-8333-333333333333",
  output = "44444444-4444-4444-8444-444444444444";
async function fixture(page, { enabled = true, status = "completed", qualities = enabled ? ["low", "medium", "high"] : [], reason = enabled ? null : "configuration_required" } = {}) {
  const photograph = await readFile(
    new URL("../../public/images/footwear-small.webp", import.meta.url),
  );
  const state = { submitted: [], status, cancelled: 0, retried: 0 };
  await page.route(/\/app(?:\/.*)?$/, async (route) =>
    route.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const record = {
      id: job,
      project_id: project,
      input_image_id: image,
      output_image_id: state.status === "completed" ? output : null,
      status: state.status,
      mode: "product",
      quality: "high",
      output_size: "1024x1024",
      model: "test-provider-model",
      created_at: "2026-10-28T00:00:00Z",
      provider_usage: { input_tokens: 50, output_tokens: 100 },
      cost_estimate_micro_usd: 3570,
      instructions: "Natural light",
      safe_to_retry: state.status === "failed",
      message:
        state.status === "uncertain"
          ? "The request may have incurred a charge. It will not be repeated automatically."
          : null,
    };
    let body = {};
    if (path === "/api/session")
      body = { profile: { display_name: "Owner", audience: "ecommerce" } };
    else if (path === "/api/processing/capabilities")
      body = {
        enabled,
        history_available: true,
        qualities,
        reason,
        default_quality: "high",
        daily_limit: 5,
      };
    else if (path === `/api/images/${image}`)
      body = {
        image: {
          id: image,
          project_id: project,
          role: "original",
          status: "ready",
          filename: "Studio reference.webp",
          audience: "ecommerce",
          width: 1024,
          height: 1024,
        },
      };
    else if (path.endsWith("/content")) {
      await route.fulfill({
        status: 200,
        contentType: "image/webp",
        body: photograph,
      });
      return;
    } else if (path === "/api/jobs" && req.method() === "POST") {
      state.submitted.push(req.postDataJSON());
      body = { job: record };
    } else if (path === `/api/jobs/${job}`) body = { job: record };
    else if (path === `/api/jobs/${job}/cancel`) {
      state.cancelled++;
      state.status = "cancelled";
      body = { ok: true };
    } else if (path === `/api/jobs/${job}/retry`) {
      state.retried++;
      state.status = "queued";
      body = { ok: true };
    } else {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: path === "/api/jobs" && req.method() === "POST" ? 202 : 200,
      json: body,
    });
  });
  return state;
}
test("all three mode controls submit validated edit settings and a stable submission identifier", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto(`/app/edit/${image}`);
  await expect(page.getByLabel("Enhancement mode")).toHaveValue("product");
  await expect(page.locator("#mode-description")).toContainText("labels");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `/tmp/phase2-editor-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("Enhancement mode").selectOption("portrait");
  await expect(page.locator("#mode-description")).toContainText("headshot");
  await expect(page.getByLabel("Background", { exact: true })).toHaveValue(
    "studio",
  );
  await page.getByLabel("Enhancement mode").selectOption("personal");
  await expect(page.locator("#mode-description")).toContainText("clarity");
  await page
    .getByLabel("Optional editing instructions")
    .fill("Keep the original appearance and improve the lighting.");
  await page.getByLabel("I have permission").check();
  await page
    .getByRole("button", { name: "Generate edited photograph" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/edits/${job}`));
  expect(state.submitted).toHaveLength(1);
  expect(state.submitted[0].mode).toBe("personal");
  expect(state.submitted[0].preserve_appearance).toBe(true);
  expect(state.submitted[0].provider_consent).toBe(true);
  expect(state.submitted[0].submission_key).toMatch(/^[a-f0-9-]{36}$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("missing provider configuration disables generation without a fabricated result", async ({
  page,
}) => {
  const state = await fixture(page, { enabled: false });
  await page.goto(`/app/edit/${image}`);
  await expect(
    page.getByRole("button", { name: "Generate edited photograph" }),
  ).toBeDisabled();
  await expect(page.locator("#edit-notice")).toContainText("not available");
  await expect(page.locator("#edit-notice")).not.toContainText("migration");
  await expect(page.getByLabel("Output quality")).toBeDisabled();
  await expect(page.getByLabel("Output quality")).toContainText("Unavailable");
  await page.getByLabel("Enhancement mode").selectOption("portrait");
  await expect(page.locator("#mode-description")).toContainText("photographs of people");
  await expect(page.getByRole("button", { name: "Generate edited photograph" })).toBeDisabled();
  expect(state.submitted).toHaveLength(0);
});
test("missing quality options cannot enable generation when the mode changes", async ({ page }) => {
  const state = await fixture(page, { enabled: true, qualities: [] });
  await page.goto(`/app/edit/${image}`);
  await page.getByLabel("Enhancement mode").selectOption("personal");
  await expect(page.getByLabel("Output quality")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Generate edited photograph" })).toBeDisabled();
  expect(state.submitted).toHaveLength(0);
});
test("database unavailability has its own notice and the reference stays in normal document flow", async ({ page }) => {
  await fixture(page, { enabled: false, reason: "migration_required" });
  await page.goto(`/app/edit/${image}`);
  await expect(page.locator("#edit-notice")).toContainText("processing database is not ready");
  await expect(page.locator(".reference-panel")).toHaveCSS("position", "static");
  await expect(page.locator("#reference-photo")).toHaveCount(1);
});
test("saved results show both private images and a working output download action", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`/app/edits/${job}`);
  await expect(
    page.getByRole("status").filter({ hasText: "Completed" }),
  ).toBeVisible();
  await expect(
    page.getByAltText("Uploaded reference photograph"),
  ).toHaveAttribute("src", `/api/images/${image}/content`);
  await expect(page.getByAltText("OpenAI-edited result")).toHaveAttribute(
    "src",
    `/api/images/${output}/content`,
  );
  await expect(
    page.getByRole("link", { name: "Download edited WebP" }),
  ).toHaveAttribute("href", `/api/images/${output}/content?download=1`);
  await page.getByText("Edit details & usage").click();
  await expect(page.locator("#job-details")).toContainText("0.003570");
  await page.reload();
  await expect(page.getByAltText("OpenAI-edited result")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("queued cancellation and uncertain billing outcomes never display fake completion", async ({
  page,
}) => {
  const state = await fixture(page, { status: "queued" });
  await page.goto(`/app/edits/${job}`);
  await expect(
    page.getByRole("link", { name: "Download edited WebP" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel queued edit" }).click();
  await expect(page.locator("#job-status")).toHaveText("Cancelled");
  expect(state.cancelled).toBe(1);
  state.status = "uncertain";
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "may have incurred a charge",
  );
  await expect(page.getByRole("button", { name: "Retry safely" })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Create another edit" }).click();
  await expect(page.locator("#uncertain-ack")).toBeVisible();
});
test("a lost submission response can be safely resubmitted with the same identifier", async ({
  page,
}) => {
  const state = await fixture(page);
  let lost = true;
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() === "POST" && lost) {
      lost = false;
      state.submitted.push(route.request().postDataJSON());
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });
  await page.goto(`/app/edit/${image}`);
  await page.getByLabel("I have permission").check();
  await page
    .getByRole("button", { name: "Generate edited photograph" })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Generate edited photograph" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/edits/${job}`));
  expect(state.submitted).toHaveLength(2);
  expect(state.submitted[0].submission_key).toBe(
    state.submitted[1].submission_key,
  );
});

for (const requested of ['personal','portrait','product','unsupported']) {
 test(`Production Hub editor handoff accepts only supported initial mode ${requested}`, async ({page}) => {
  const state=await fixture(page,{enabled:false});
  await page.goto(`/app/edit/${image}?mode=${requested}`);
  await expect(page.getByLabel('Enhancement mode')).toHaveValue(requested==='unsupported'?'product':requested);
  await expect(page.locator('[name=provider_consent]')).not.toBeChecked();
  await expect(page.getByRole('button',{name:'Generate edited photograph'})).toBeDisabled();
  expect(state.submitted).toEqual([]);
 });
}
