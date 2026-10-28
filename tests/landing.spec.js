import { test, expect } from "@playwright/test";
test("navigation, artwork, disclosures, and layout", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/SONKOFLOW/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Every image",
  );
  await expect(page.locator("#availability")).toContainText(
    "service activation",
  );
  for (const image of await page.locator("img:visible").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((el) => el.complete && el.naturalWidth > 0))
      .toBeTruthy();
  }
  for (const element of await page.locator("[data-reveal]").all()) {
    await element.scrollIntoViewIfNeeded();
    await expect(element).toHaveClass(/is-visible/);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  for (const href of await page
    .locator("a")
    .evaluateAll((els) => els.map((el) => el.getAttribute("href")))) {
    expect(
      href.startsWith("#") ||
        href.startsWith("/#") ||
        href.startsWith("/app/") ||
        href.startsWith("/pricing#") ||
        [
          "/",
          "/app",
          "/pricing",
          "/terms",
          "/privacy",
          "/cookies",
          "/legal",
          "/account/signin",
          "/account/signup",
          "/account/recover",
        ].includes(href),
    ).toBeTruthy();
    if (href.startsWith("#") && href !== "#")
      await expect(page.locator(href)).toHaveCount(1);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect(page.locator("body")).not.toContainText("Try SONKOFLOW Free");
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("mobile menu and escape", async ({ page }) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: /Menu/ });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page
      .locator("#navigation")
      .getByRole("link", { name: "Brand Studio" })
      .click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  }
});
test("comparison and FAQ are functional", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByRole("slider");
  await slider.fill("70");
  await expect(page.locator(".comparison")).toHaveCSS("--split", "70%");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("71");
  const question = page.locator(".faq-list summary").first();
  await question.click();
  await expect(page.locator(".faq-list details").first()).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".faq-list details").first()).toContainText(
    "AI enhancement",
  );
});
test("reduced motion is respected", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".hero-art")).toHaveCSS("animation-name", "none");
});

test("landing content and navigation remain accessible without JavaScript", async ({
  browser,
  page,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: page.viewportSize(),
  });
  const fallback = await context.newPage();
  await fallback.goto("http://127.0.0.1:4173/");
  await expect(fallback.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(fallback.locator("#how-it-works h2")).toBeVisible();
  await expect(
    fallback
      .locator("#navigation")
      .getByRole("link", { name: "The workspace" }),
  ).toBeVisible();
  expect(
    await fallback.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await context.close();
});

test("enhancement audiences support keyboard tabs and disclose illustrative content", async ({
  page,
}) => {
  await page.goto("/");
  const first = page.getByRole("tab", { name: "For your products" });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "For your profession" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-portrait")).toBeVisible();
  await expect(page.locator("#panel-product")).toBeHidden();
  await page.keyboard.press("End");
  await expect(page.locator("#panel-personal")).toBeVisible();
  await expect(page.locator(".image-disclosure")).toContainText(
    "not customer photographs",
  );
  await expect(page.locator(".footer-bottom")).toContainText(
    "All rights reserved © 2026 SonkoFlow, a product of AaronPrime PTY LTD.",
  );
});
