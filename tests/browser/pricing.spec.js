import { test, expect } from "@playwright/test";
test("pricing cards, real activation notice, illustrations and keyboard dialog work responsively", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/pricing");
  await expect(page).toHaveTitle(/Pricing.*SONKOFLOW/);
  await expect(page.locator(".plan-card")).toHaveCount(3);
  await expect(page.locator("#once-cards article")).toHaveCount(2);
  await expect(page.locator("#billing-toggle")).toBeVisible();
  await expect(page.locator("#billing-toggle")).toContainText("Save 20%");
  await expect(page.locator("#pricing-status")).toContainText("awaiting");
  await expect(page.locator(".plan-card").nth(1)).toContainText("$9");
  await expect(page.locator(".plan-card").nth(2)).toContainText("$19");
  for (const img of await page.locator(".price-hero img").all())
    expect(
      await img.evaluate((n) => n.complete && n.naturalWidth > 0),
    ).toBeTruthy();
  await page
    .getByRole("button", { name: "Choose Starter", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#order-summary")).toContainText("$9");
  await page
    .locator("#order-plan-tabs")
    .getByRole("button", { name: "Pro", exact: true })
    .click();
  await expect(page.locator("#order-summary")).toContainText("$19");
  await page.screenshot({
    path: `test-results/pricing-modal-${info.project.name}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `test-results/pricing-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("selection creates an intent before authentication and setup failures cannot fake checkout", async ({
  page,
}) => {
  await page.goto("/pricing");
  await page.getByRole("button", { name: "Start free", exact: true }).click();
  await page.locator("#continue-order").click();
  await expect(page.locator("#order-status")).toContainText(
    /not configured|not available/,
  );
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.locator("#order-summary")).toContainText("$0");
});
test("annual selection shows the exact up-front price and units; authenticated continuation keeps the offer", async ({
  page,
}) => {
  await page.route("**/api/public/pricing", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      json: {
        ...body,
        enabled: true,
        checkout_enabled: true,
        annual_supported: true,
        reason: null,
      },
    });
  });
  await page.route(/\/app(?:\/.*)?$/, async (route) =>
    route.fulfill({ response: await page.request.get("/account/signin") }),
  );
  let selected;
  await page.route("**/api/public/billing/intents", async (route) => {
    selected = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { next: "/app/checkout" } });
  });
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { profile: { id: "test-owner" } } }),
  );
  await page.goto("/pricing");
  await page.getByRole("button", { name: /Yearly/ }).click();
  await expect(page.locator(".plan-card").nth(1)).toContainText(
    "$86.40 billed yearly",
  );
  await page
    .getByRole("button", { name: "Choose Starter", exact: true })
    .click();
  await expect(page.locator("#order-summary")).toContainText("1,200");
  await expect(page.locator("#order-summary")).toContainText("$86.40");
  await page.locator("#continue-order").click();
  await expect.poll(() => selected).toEqual({ offer_id: "starter_annual" });
  await expect(page).toHaveURL(/\/app\/checkout/);
});

test("existing-account sign-in preserves a selected one-time pack before leaving pricing", async ({
  page,
}) => {
  let selected;
  await page.route("**/api/public/billing/intents", async (route) => {
    selected = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { next: "/app/checkout" } });
  });
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: "Sign in required" } },
    }),
  );
  await page.goto("/pricing");
  await page
    .getByRole("button", { name: "Choose one-time pack" })
    .last()
    .click();
  await page
    .getByRole("link", { name: "Already have an account? Sign in" })
    .click();
  await expect(page).toHaveURL(/\/account\/signin\?next=checkout/);
  expect(selected).toEqual({ offer_id: "studio_pack" });
});
async function accountFixture(page) {
  await page.route(/\/app(?:\/.*)?$/, async (route) =>
    route.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        profile: {
          id: "test-owner",
          display_name: "Test Studio",
          audience: "ecommerce",
        },
      },
    }),
  );
}
test("free checkout initializes the real account path and welcome creates a real project request", async ({
  page,
}) => {
  await accountFixture(page);
  let initialized = 0,
    project;
  await page.route("**/api/billing/current", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        paypal_ready: false,
        checkout: {
          id: "free-checkout",
          offer_id: "free",
          status: "selected",
          amount_cents: 0,
          units: 20,
        },
      },
    }),
  );
  await page.route("**/api/billing/free", (route) => {
    initialized++;
    return route.fulfill({ json: { next: "/app/welcome" } });
  });
  await page.route("**/api/billing/account", (route) =>
    route.fulfill({
      json: {
        plan: "free",
        account: { balance_credits: 20, reserved_credits: 0 },
        subscriptions: [],
        receipts: [],
      },
    }),
  );
  await page.route("**/api/projects", (route) => {
    project = route.request().postDataJSON();
    return route.fulfill({ json: { project: { id: "new-project" } } });
  });
  await page.goto("/app/checkout");
  await page.getByRole("button", { name: "Open my free workspace" }).click();
  await expect(page).toHaveURL(/\/app\/welcome/);
  expect(initialized).toBe(1);
  await expect(page.locator("#welcome-notice")).toContainText(
    "20 processing units",
  );
  await page.getByLabel("Project name").fill("Spring collection");
  await page.getByRole("button", { name: "Create my first project" }).click();
  await expect
    .poll(() => project)
    .toEqual({ name: "Spring collection", audience: "ecommerce" });
  await expect(page).toHaveURL(/\/app\/projects\/new-project/);
});
test("a return query cannot unlock paid status; verified payment history renders only server records", async ({
  page,
}) => {
  await accountFixture(page);
  await page.route("**/api/billing/current", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        paypal_ready: true,
        checkout: {
          id: "pending-checkout",
          offer_id: "small_pack",
          status: "pending",
          amount_cents: 500,
          units: 50,
        },
      },
    }),
  );
  await page.route("**/api/billing/checkouts/pending-checkout", (route) =>
    route.fulfill({ json: { checkout: { status: "pending" } } }),
  );
  await page.route(
    "**/api/billing/checkouts/pending-checkout/capture",
    (route) =>
      route.fulfill({ json: { status: "awaiting_verified_notification" } }),
  );
  await page.goto("/app/checkout?returned=1");
  await expect(page.locator("#checkout-notice")).toContainText(
    "waiting for verified",
  );
  await page.getByRole("button", { name: "Check payment status" }).click();
  await expect(page.locator("#checkout-notice")).toContainText(
    "has not been activated",
  );
  await page.route("**/api/billing/account", (route) =>
    route.fulfill({
      json: {
        plan: "payg",
        account: { balance_credits: 70, reserved_credits: 10 },
        subscriptions: [],
        receipts: [
          {
            units: 50,
            amount_cents: 500,
            refunded_cents: 0,
            created_at: "2026-10-28T00:00:00Z",
            payment_id: "CAPTURE-TEST",
          },
        ],
      },
    }),
  );
  await page.goto("/app/billing");
  await expect(page.locator("#billing-balance")).toContainText(
    "60 available units",
  );
  await expect(page.locator("#billing-receipts")).toContainText(
    "50 processing units",
  );
  await expect(page.locator("#billing-receipts")).toContainText("CAPTURE-TEST");
});


test("annual prices stay visible while unconfigured checkout remains disabled", async ({ page }) => {
  await page.goto('/pricing');
  await page.getByRole('button', { name: /Yearly/ }).click();
  await expect(page.locator('.plan-card').nth(1)).toContainText('$86.40 billed yearly');
  await expect(page.locator('.plan-card').nth(2)).toContainText('$182.40 billed yearly');
  await expect(page.locator('.plan-card').nth(1)).toContainText('Essential & Studio');
  await expect(page.locator('.plan-card').nth(2)).toContainText('Signature');
  await page.getByRole('button', { name: 'Choose Pro', exact: true }).click();
  await expect(page.locator('#order-summary')).toContainText('$182.40');
  await expect(page.locator('#continue-order')).toBeDisabled();
  await expect(page.locator('#order-status')).toContainText('awaiting merchant configuration');
});


test('plan dialog keeps the full order and actions visible without internal scrolling', async ({ page }, info) => {
  const viewport = info.project.name === 'desktop' ? {width:1280,height:640}
    : info.project.name === 'tablet' ? {width:768,height:1024} : {width:390,height:844};
  await page.setViewportSize(viewport);
  await page.goto('/pricing');
  for (const name of ['Choose Starter', 'Choose Pro', 'Start free', 'Choose one-time pack']) {
    await page.getByRole('button', {name, exact:true}).first().click();
    const dialog = page.locator('#plan-dialog');
    await expect(dialog).toBeVisible();
    const measure = async () => dialog.evaluate(el => {
      const box = el.getBoundingClientRect();
      const action = document.querySelector('#continue-order').getBoundingClientRect();
      const terms = document.querySelector('.order-selection > .small-copy:last-child').getBoundingClientRect();
      return {fits:el.scrollHeight <= el.clientHeight + 1, visible:box.top >= 0 && box.bottom <= innerHeight,
        actionVisible:action.top >= box.top && action.bottom <= box.bottom,
        termsVisible:terms.bottom <= box.bottom};
    });
    expect(await measure()).toEqual({fits:true,visible:true,actionVisible:true,termsVisible:true});
    if (name === 'Choose Starter' || name === 'Choose Pro') {
      await page.getByRole('radio', {name:/Yearly/}).check();
      expect(await measure()).toEqual({fits:true,visible:true,actionVisible:true,termsVisible:true});
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});
