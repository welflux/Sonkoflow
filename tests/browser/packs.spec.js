import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const project = "11111111-1111-4111-8111-111111111111",
  image = "22222222-2222-4222-8222-222222222222",
  pack = "33333333-3333-4333-8333-333333333333",
  job = "44444444-4444-4444-8444-444444444444",
  output = "55555555-5555-4555-8555-555555555555",
  child = "66666666-6666-4666-8666-666666666666";
const specs = {
  listing: {
    name: "Clean Listing Image",
    size: "1024x1024",
    aspect: "1:1",
    creative: false,
    description: "Preserve product and print.",
  },
  lifestyle: {
    name: "Lifestyle Scene",
    size: "1536x1024",
    aspect: "3:2",
    creative: true,
    description: "Creative setting with original reference.",
  },
  detail: {
    name: "Detail Image",
    size: "1024x1024",
    aspect: "1:1",
    creative: false,
    description: "Visible details only.",
  },
  social: {
    name: "Square Social Image",
    size: "1024x1024",
    aspect: "1:1",
    creative: false,
    description: "Square composition; no compliance guarantee.",
  },
  wide: {
    name: "Wide Promotional Image",
    size: "1536x1024",
    aspect: "3:2",
    creative: true,
    description: "Landscape promotional space.",
  },
};
async function fixture(page, { allowance = 1000, outputLimit = 5 } = {}) {
  const photograph = await readFile(
    new URL("../../public/images/footwear-small.webp", import.meta.url),
  );
  const root = {
    id: job,
    pack_id: pack,
    pack_output_type: "listing",
    project_id: project,
    input_image_id: image,
    output_image_id: output,
    status: "completed",
    mode: "product",
    quality: "high",
    model: "test-only",
    output_size: "1024x1024",
    created_at: "2026-10-28T00:00:00Z",
    attempts: 1,
    pack_estimated_credits: 20,
    pack_reserved_credits: 30,
    quality_retry_limit: 2,
    quality_retry_number: 0,
    user_decision: "pending",
    decision_revision: 0,
    quality_state: "completed",
    quality_report: {
      status: "needs_review",
      checks: [
        {
          id: "labels_details",
          label: "Labels and print",
          status: "needs_review",
          method: "vision",
          confidence: "low",
          explanation: "Review the visible label.",
        },
      ],
    },
  };
  const state = {
    created: [],
    quotes: [],
    retries: [],
    retryQuotes: [],
    lost: false,
    failed: "failed",
    root,
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
    else if (path === "/api/packs/capabilities")
      body = {
        enabled: true,
        history_available: true,
        outputs: specs,
        max_outputs: outputLimit,
        qualities: ["low", "medium", "high"],
        default_quality: "high",
      };
    else if (path === `/api/images/${image}`)
      body = {
        image: {
          id: image,
          project_id: project,
          filename: "Product original.webp",
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
            filename: "Product original.webp",
            role: "original",
            status: "ready",
          },
        ],
      };
    else if (path.endsWith("/content")) {
      await route.fulfill({ contentType: "image/webp", body: photograph });
      return;
    } else if (path === "/api/packs/quote") {
      const p = route.request().postDataJSON();
      state.quotes.push(p);
      const total = p.outputs.length * 30;
      body = {
        outputs: p.outputs.map((o) => ({
          ...o,
          ...specs[o.type],
          estimated_credits: 20,
          reserved_credits: 30,
        })),
        estimated_credits: p.outputs.length * 20,
        reserved_credits: total,
        quote_fingerprint: "a".repeat(64),
        allowance: { available_credits: allowance, reserved_credits: 0 },
        can_generate: allowance >= total,
      };
    } else if (path === "/api/packs" && method === "POST") {
      state.created.push(route.request().postDataJSON());
      if (state.lost) {
        state.lost = false;
        await route.abort("failed");
        return;
      }
      body = { pack: { id: pack } };
    } else if (path === `/api/packs/${pack}`) {
      const failed = {
        ...root,
        id: child,
        pack_output_type: "lifestyle",
        status: state.failed,
        output_image_id: null,
        quality_state: "not_applicable",
        quality_report: null,
        user_decision: "pending",
        safe_to_retry: true,
        message:
          state.failed === "failed" ? "Provider access needs attention." : null,
      };
      const queued = {
        ...root,
        id: project,
        pack_output_type: "detail",
        status: "queued",
        output_image_id: null,
        quality_state: "not_applicable",
        quality_report: null,
        user_decision: "pending",
      };
      const outputs = [
        ["listing", root],
        ["lifestyle", failed],
        ["detail", queued],
      ].map(([type, current]) => ({
        type,
        spec: specs[type],
        current,
        approved: current.user_decision === "approved" ? current : null,
        versions: [current],
      }));
      body = {
        pack: { id: pack, project_id: project, input_image_id: image },
        outputs,
        progress: {
          total: 3,
          completed: 1,
          failed: state.failed === "failed" ? 1 : 0,
          pending: state.failed === "failed" ? 1 : 2,
          reviewing: ["pending", "running"].includes(root.quality_state)
            ? 1
            : 0,
          approved: root.user_decision === "approved" ? 1 : 0,
        },
      };
    } else if (path === `/api/jobs/${job}/decision`) {
      const p = route.request().postDataJSON();
      root.user_decision = p.decision;
      root.decision_revision++;
      body = { ok: true };
    } else if (path === `/api/jobs/${child}/retry`) {
      state.failed = "queued";
      body = { ok: true };
    } else if (path === `/api/packs/outputs/${job}/retry-plan`) {
      state.retryQuotes.push(route.request().postDataJSON());
      body = {
        quote_fingerprint: "b".repeat(64),
        estimated_credits: 20,
        reserved_credits: 30,
        allowance: { available_credits: allowance },
        can_generate: allowance >= 30,
      };
    } else if (path === `/api/jobs/${job}/quality-retry`) {
      state.retries.push(route.request().postDataJSON());
      body = { job: { ...root, id: child } };
    } else if (path === `/api/jobs/${child}`)
      body = {
        job: {
          ...root,
          id: child,
          status: "queued",
          quality_state: "not_applicable",
          output_image_id: null,
        },
      };
    else if (path === "/api/processing/capabilities")
      body = {
        enabled: true,
        history_available: true,
        qualities: ["high"],
        default_quality: "high",
      };
    else {
      await route.abort();
      return;
    }
    await route.fulfill({
      json: body,
      status: method === "POST" && path === "/api/packs" ? 202 : 200,
    });
  });
  return state;
}
test("a complete pack requires a real plan and consent before one generation action", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/app/packs/new/${image}`);
  await expect(
    page.getByRole("button", { name: "Generate image pack" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Select complete pack" }).click();
  await page.getByRole("button", { name: "Review pack plan" }).click();
  await expect(page.locator("#pack-quote")).toContainText(
    "Required allowance hold: 150 credits",
  );
  expect(state.quotes[0].outputs).toHaveLength(5);
  await expect(
    page.getByRole("button", { name: "Generate image pack" }),
  ).toBeDisabled();
  await page.getByLabel("I authorize these OpenAI edits").check();
  await page.getByRole("button", { name: "Generate image pack" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/packs/${pack}`));
  expect(state.created).toHaveLength(1);
  expect(state.created[0].provider_consent).toBe(true);
  expect(state.created[0].submission_key).toMatch(/^[a-f0-9-]{36}$/);
});
test("insufficient allowance prevents generation and changing configuration invalidates a reviewed plan", async ({
  page,
}) => {
  const state = await fixture(page, { allowance: 0 });
  await page.goto(`/app/packs/new/${image}`);
  await page.getByRole("button", { name: "Review pack plan" }).click();
  await expect(page.locator("#pack-quote")).toContainText("Insufficient");
  await page.getByLabel("I authorize these OpenAI edits").check();
  await expect(
    page.getByRole("button", { name: "Generate image pack" }),
  ).toBeDisabled();
  expect(state.created).toHaveLength(0);
  await page.getByLabel("Clean Listing Image quality").selectOption("low");
  await expect(page.locator("#pack-quote")).toBeHidden();
});
test("a lost pack creation response reuses its submission key without an accidental new pack", async ({
  page,
}) => {
  const state = await fixture(page);
  state.lost = true;
  await page.goto(`/app/packs/new/${image}`);
  await page.getByRole("button", { name: "Review pack plan" }).click();
  await page.getByLabel("I authorize these OpenAI edits").check();
  await page.getByRole("button", { name: "Generate image pack" }).click();
  await expect(page.locator("#pack-quote [role=alert]")).toBeVisible();
  await page.getByRole("button", { name: "Generate image pack" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/packs/${pack}`));
  expect(state.created).toHaveLength(2);
  expect(state.created[0].submission_key).toBe(state.created[1].submission_key);
});
test("partial gallery shows only actual saved outputs and ZIP follows explicit approval", async ({
  page,
}, testInfo) => {
  await fixture(page);
  await page.goto(`/app/packs/${pack}`);
  await expect(page.locator("#pack-progress")).toContainText(
    "1 of 3 types have saved results",
  );
  await expect(
    page.locator("[data-type=lifestyle] .result-image img"),
  ).toHaveCount(1);
  await expect(
    page.locator("[data-type=detail] .result-image img"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /Download approved ZIP/ }),
  ).toHaveCount(0);
  const listing = page.locator("[data-type=listing]");
  await listing.locator(".pack-review summary").click();
  await listing.getByLabel("I compared the original and result").check();
  await listing.getByRole("button", { name: "Approve result" }).click();
  await expect(
    page.getByRole("link", { name: /Download approved ZIP/ }),
  ).toHaveAttribute("href", `/api/packs/${pack}/download`);
  await page.getByRole("button", { name: "Retry eligible output" }).click();
  await expect(
    page.locator("[data-type=lifestyle] .pack-output-status"),
  ).toContainText("Queued");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `/tmp/phase4-pack-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("partial-pack polling preserves a customer correction and pack retry requires a new allowance quote", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/app/packs/${pack}`);
  const listing = page.locator("[data-type=listing]");
  await listing.locator(".pack-review summary").click();
  await listing.getByLabel("Labels and print", { exact: true }).check();
  await listing
    .getByLabel("Describe the correction")
    .fill("Keep the exact original print.");
  await page.waitForTimeout(4000);
  await expect(listing.getByLabel("Describe the correction")).toHaveValue(
    "Keep the exact original print.",
  );
  await expect(
    listing.getByRole("button", { name: "Generate controlled retry" }),
  ).toBeDisabled();
  await listing.getByRole("button", { name: "Review retry allowance" }).click();
  await listing.getByLabel("I authorize another OpenAI edit").check();
  await listing
    .getByRole("button", { name: "Generate controlled retry" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/edits/${child}`));
  expect(state.retries[0].quote_fingerprint).toBe("b".repeat(64));
  expect(state.retryQuotes).toHaveLength(1);
});
test("configured output limits are explicit and cannot be bypassed with complete-pack selection", async ({
  page,
}) => {
  const state = await fixture(page, { outputLimit: 2 });
  await page.goto(`/app/packs/new/${image}`);
  await expect(
    page.getByRole("button", { name: "Select complete pack" }),
  ).toBeDisabled();
  await page.getByLabel("Lifestyle Scene", { exact: true }).check();
  await page.getByLabel("Detail Image", { exact: true }).check();
  await page.getByRole("button", { name: "Review pack plan" }).click();
  await expect(page.locator("#pack-form-notice")).toContainText("at most 2");
  expect(state.quotes).toHaveLength(0);
});
test("unfinished assessment never appears Passed even when its local checks have passed", async ({
  page,
}) => {
  const state = await fixture(page);
  state.root.quality_state = "running";
  state.root.quality_report = { status: "passed", checks: [] };
  await page.goto(`/app/packs/${pack}`);
  const listing = page.locator("[data-type=listing]");
  await expect(listing.locator(".pack-output-status")).toContainText(
    "Quality: Assessing",
  );
  await expect(listing.locator(".pack-output-status")).not.toContainText(
    "Passed",
  );
  await listing.locator(".pack-review summary").click();
  await expect(
    listing.getByRole("button", { name: "Approve result" }),
  ).toHaveCount(0);
});
