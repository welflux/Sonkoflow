import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const project = "11111111-1111-4111-8111-111111111111",
  batch = "22222222-2222-4222-8222-222222222222",
  pack = "33333333-3333-4333-8333-333333333333";
async function fixture(page) {
  const state = { uploads: [], quotes: [], creates: [], cancelled: false };
  await page.route("**/app/**", async (r) =>
    r.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === "/api/session")
      body = { profile: { display_name: "Owner", audience: "ecommerce" } };
    else if (path === "/api/projects")
      body = { projects: [{ id: project, name: "Products" }] };
    else if (path === "/api/brands/capabilities") body = { available: false };
    else if (path === "/api/batches/capabilities")
      body = {
        available: true,
        max_images: 5,
        max_bytes: 52428800,
        file_bytes: 10485760,
        formats: ["image/webp", "image/jpeg", "image/png"],
      };
    else if (path === "/api/batches" && route.request().method() === "GET")
      body = { batches: [] };
    else if (path === "/api/images") {
      state.uploads.push(1);
      return route.fulfill({ status: 201, json: {} });
    } else if (path === "/api/batches/quote") {
      state.quotes.push(route.request().postDataJSON());
      body = {
        images: state.quotes.at(-1).image_ids.length,
        outputs: 2,
        estimated_credits: 20,
        reserved_credits: 30,
        allowance: { available_credits: 100 },
        can_generate: true,
        quote_fingerprint: "a".repeat(64),
      };
    } else if (path === "/api/batches") {
      state.creates.push(route.request().postDataJSON());
      return route.fulfill({
        status: 503,
        json: { error: { message: "Test stops before paid generation." } },
      });
    } else if (path.endsWith("/cancel")) {
      state.cancelled = true;
      body = { cancel_requested: true };
    } else if (path === `/api/batches/${batch}`)
      body = {
        batch: { name: "Spring products" },
        status: "partially_completed",
        counts: {
          total: 2,
          queued: 0,
          processing: 0,
          completed: 1,
          failed: 1,
          cancelled: 0,
        },
        items: [
          {
            position: 0,
            pack_id: pack,
            input_image_id: project,
            progress: { approved: 1 },
            outputs: [
              {
                spec: { name: "Listing" },
                current: {
                  status: "completed",
                  quality_state: "completed",
                  user_decision: "approved",
                },
              },
            ],
          },
          {
            position: 1,
            pack_id: batch,
            input_image_id: project,
            progress: { approved: 0 },
            outputs: [
              {
                spec: { name: "Listing" },
                current: {
                  status: "failed",
                  quality_state: "not_applicable",
                  user_decision: "pending",
                  message: "Provider unavailable",
                },
              },
            ],
          },
        ],
      };
    return route.fulfill({ json: body });
  });
  return state;
}
test("Multiple uploads can be reviewed and removed before a genuine allowance confirmation; lost response reuses submission ID", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/app/batches");
  await page.getByLabel("Batch name").fill("Spring");
  const buffer = await readFile("public/images/footwear-small.webp");
  await page.locator("input[type=file]").setInputFiles([
    { name: "one.webp", mimeType: "image/webp", buffer },
    { name: "two.webp", mimeType: "image/webp", buffer },
  ]);
  await expect(page.locator(".batch-file-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Upload and review allowance" })
    .click();
  await expect(page.locator("#batch-quote")).toBeVisible();
  expect(s.uploads).toHaveLength(1);
  expect(s.quotes[0].image_ids).toHaveLength(1);
  await page.locator("#batch-quote input").check();
  await page.getByRole("button", { name: "Confirm batch" }).click();
  await expect(
    page.getByText("Test stops before paid generation."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm batch" }).click();
  await expect.poll(() => s.creates.length).toBe(2);
  expect(s.creates[0].submission_key).toBe(s.creates[1].submission_key);
});
test("Partial dashboard preserves real statuses and exposes only approved selections plus existing review/retry workflow", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`/app/batches/${batch}`);
  await expect(page.locator("#batch-progress")).toContainText(
    "1 failed/partial",
  );
  await expect(
    page.getByText("Provider unavailable", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("#batch-items input[type=checkbox]")).toHaveCount(
    1,
  );
  await expect(page.locator(`a[href="/app/packs/${pack}"]`)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel queued work" }).click();
  await expect(page.locator("#batch-progress")).toContainText("1 completed");
});
