import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
const project = "11111111-1111-4111-8111-111111111111",
  image = "22222222-2222-4222-8222-222222222222",
  job = "33333333-3333-4333-8333-333333333333",
  output = "44444444-4444-4444-8444-444444444444",
  child = "55555555-5555-4555-8555-555555555555";
async function fixture(
  page,
  { state = "completed", status = "needs_review", limit = 2 } = {},
) {
  const photo = await readFile(
    new URL("../../public/images/footwear-small.webp", import.meta.url),
  );
  const saved = {
    id: job,
    project_id: project,
    input_image_id: image,
    output_image_id: output,
    status: "completed",
    mode: "product",
    quality: "high",
    output_size: "1024x1024",
    model: "test-only",
    created_at: "2026-10-28T00:00:00Z",
    settings: { background: "clean" },
    quality_state: state,
    quality_report: {
      status,
      checks: [
        {
          id: "integrity",
          label: "Image readability & format",
          status: "passed",
          method: "objective",
          confidence: null,
          explanation:
            "The file decodes successfully. This does not establish product fidelity.",
        },
        {
          id: "labels_details",
          label: "Labels, packaging & distinctive details",
          status: status === "passed" ? "passed" : "needs_review",
          method: "vision",
          confidence: status === "passed" ? "medium" : "low",
          explanation:
            "Print is too small to verify. <img src=x onerror=alert(1)> is plain text.",
        },
      ],
    },
    quality_retry_number: 0,
    quality_retry_used: 0,
    quality_retry_limit: limit,
    user_decision: "pending",
    decision_revision: 0,
    quality_decisions: [],
  };
  const data = {
    saved,
    submissions: [],
    decisions: [],
    retries: [],
    loseRetry: false,
  };
  await page.route(/\/app(?:\/.*)?$/, async (route) =>
    route.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    let body;
    if (path === "/api/session")
      body = { profile: { display_name: "Owner", audience: "ecommerce" } };
    else if (path === "/api/processing/capabilities")
      body = {
        enabled: true,
        history_available: true,
        product_quality_available: true,
        vision_assessment: true,
        qualities: ["low", "medium", "high"],
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
          filename: "Product reference.webp",
          audience: "ecommerce",
        },
      };
    else if (path.endsWith("/content")) {
      await route.fulfill({ contentType: "image/webp", body: photo });
      return;
    } else if (path === "/api/jobs" && method === "POST") {
      data.submissions.push(route.request().postDataJSON());
      body = { job: saved };
    } else if (path === `/api/jobs/${job}`) body = { job: saved };
    else if (path === `/api/jobs/${child}`)
      body = {
        job: {
          ...saved,
          id: child,
          quality_parent_id: job,
          quality_retry_number: 1,
          quality_retry_used: 1,
          user_decision: "pending",
          quality_state: "pending",
        },
      };
    else if (path === `/api/jobs/${job}/decision`) {
      const b = route.request().postDataJSON();
      data.decisions.push(b);
      saved.user_decision = b.decision;
      saved.decision_revision++;
      saved.quality_decisions.push({
        decision: b.decision,
        revision: saved.decision_revision,
        at: "2026-10-28T00:05:00Z",
      });
      body = { ok: true };
    } else if (path === `/api/jobs/${job}/quality-retry`) {
      data.retries.push(route.request().postDataJSON());
      if (data.loseRetry) {
        data.loseRetry = false;
        await route.abort("failed");
        return;
      }
      body = { job: { ...saved, id: child } };
    } else {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: method === "POST" && path === "/api/jobs" ? 202 : 200,
      json: body,
    });
  });
  return data;
}
test("product operations and optional region are sent, without changing personal mode settings", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/app/edit/${image}`);
  await expect(page.locator("#product-controls")).toBeVisible();
  await page.getByLabel("Background cleanup or neutral replacement").uncheck();
  await expect(page.getByLabel("Background", { exact: true })).toBeDisabled();
  await page.getByLabel("Focus local comparisons").check();
  await page.getByLabel("Left (%)").fill("15");
  await page.getByLabel("Width (%)").fill("70");
  await page.getByLabel("I have permission").check();
  await page
    .getByRole("button", { name: "Generate edited photograph" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/edits/${job}`));
  expect(state.submissions[0].background).toBe("preserve");
  expect(state.submissions[0].product_options.operations).not.toContain(
    "background",
  );
  expect(state.submissions[0].product_options.region.left).toBe(0.15);
  expect(state.submissions[0].product_options.preserve_arrangement).toBe(true);
});
test("quality checks remain distinct from customer approval and decisions persist on reload", async ({
  page,
}, testInfo) => {
  const state = await fixture(page, { status: "passed" });
  await page.goto(`/app/edits/${job}`);
  await expect(page.locator(".quality-status")).toHaveText("Passed");
  await expect(page.locator(".customer-decision")).toContainText(
    "Awaiting your review",
  );
  await expect(
    page.getByRole("button", { name: "Approve result" }),
  ).toBeDisabled();
  await expect(page.locator(".quality-checks")).toContainText("not calibrated");
  expect(await page.locator(".quality-checks img").count()).toBe(0);
  await page.getByLabel("I compared the original and result").check();
  await page.getByRole("button", { name: "Approve result" }).click();
  await expect(page.locator(".customer-decision")).toContainText("Approved");
  expect(state.decisions).toHaveLength(1);
  expect(state.decisions[0].reviewed).toBe(true);
  await page.reload();
  await expect(page.locator(".customer-decision")).toContainText("Approved");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `/tmp/phase3-review-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("targeted retry uses selected concerns and reuses its submission key after a lost response", async ({
  page,
}) => {
  const state = await fixture(page);
  state.loseRetry = true;
  await page.goto(`/app/edits/${job}`);
  await page
    .getByLabel("Labels, packaging & distinctive details", { exact: true })
    .check();
  await page
    .getByLabel("Describe the correction")
    .fill("Keep the original printed label unchanged.");
  await page.getByLabel("I authorize another OpenAI edit").check();
  await page.getByRole("button", { name: "Generate controlled retry" }).click();
  await expect(page.locator("#product-quality [role=alert]")).toBeVisible();
  await page.getByRole("button", { name: "Generate controlled retry" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/edits/${child}`));
  expect(state.retries).toHaveLength(2);
  expect(state.retries[0].submission_key).toBe(state.retries[1].submission_key);
  expect(state.retries[0].targets).toEqual(["labels_details"]);
  await expect(page.locator("#product-quality")).toContainText(
    "Assessment queued",
  );
  await expect(
    page.getByRole("button", { name: "Approve result" }),
  ).toHaveCount(0);
});
test("assessment failure retains the image and download, exposes limits and permits rejection", async ({
  page,
}) => {
  const state = await fixture(page, { state: "unavailable", limit: 0 });
  await page.goto(`/app/edits/${job}`);
  await expect(page.locator(".quality-status")).toContainText("unavailable");
  await expect(page.getByAltText("OpenAI-edited result")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download edited WebP" }),
  ).toHaveAttribute("href", `/api/images/${output}/content?download=1`);
  await expect(page.locator("#product-quality")).toContainText(
    "retry limit has been reached",
  );
  await expect(
    page.getByRole("button", { name: "Generate controlled retry" }),
  ).toHaveCount(0);
  await page.getByLabel("I compared the original and result").check();
  await page.getByRole("button", { name: "Reject result" }).click();
  await expect(page.locator(".customer-decision")).toContainText("Rejected");
  expect(state.decisions[0].decision).toBe("rejected");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("unavailable semantic checks require a customer-described concern rather than a blind retry", async ({
  page,
}) => {
  const state = await fixture(page);
  state.saved.quality_report.checks = [
    {
      id: "labels_details",
      label: "Labels and print",
      status: "unavailable",
      method: "availability",
      confidence: null,
      explanation: "Not assessed. Compare the original and result yourself.",
    },
  ];
  await page.goto(`/app/edits/${job}`);
  await expect(page.locator(".quality-checks")).toContainText("Unavailable");
  await expect(page.locator(".quality-retry-form fieldset input")).toHaveCount(
    1,
  );
  await page.getByLabel("A specific detail I noticed").check();
  await page.getByLabel("I authorize another OpenAI edit").check();
  await page.getByRole("button", { name: "Generate controlled retry" }).click();
  await expect(page.locator("#product-quality [role=alert]")).toContainText(
    "Describe the specific",
  );
  expect(state.retries).toHaveLength(0);
});
