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

test('narrow phone and tablet layouts keep navigation and content within the viewport', async ({ page }) => {
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByRole('button', { name: /Menu/ }).click();
    await expect(page.locator('#navigation').getByRole('link', { name: 'Pricing', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Menu/ })).toHaveAttribute('aria-expanded', 'false');
  }
});

test('shared Inter typography follows the desktop, tablet and mobile scale', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const width = page.viewportSize().width;
  await expect(page.locator('body')).toHaveCSS('font-family', /Inter/);
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(107, 114, 128)');
  await expect(page.locator('.hero-intro')).toHaveCSS('font-size', width <= 600 ? '14px' : '15px');
  await expect(page.locator('.hero-intro')).toHaveCSS('line-height', '24px');
  await expect(page.locator('.hero-intro')).toHaveCSS('font-weight', '500');
  await expect(page.locator('h1').first()).toHaveCSS('font-size', width <= 600 ? '36px' : width <= 1100 ? '44px' : '56px');
  await expect(page.locator('h2').first()).toHaveCSS('font-size', width <= 600 ? '28px' : width <= 1100 ? '34px' : '40px');
  await expect(page.locator('h3').first()).toHaveCSS('font-size', width <= 600 ? '24px' : width <= 1100 ? '26px' : '30px');
  await expect(page.locator('h1').first()).toHaveCSS('color', 'rgb(20, 22, 27)');
  await expect(page.locator('.footer-bottom p')).toHaveCSS('font-size', '14px');
  expect(await page.evaluate(() => document.fonts.check('500 15px Inter'))).toBeTruthy();
});

test('hero phrase types repeatedly without layout shift and respects reduced motion', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const word = page.locator('h1 em');
  const ink = word.locator('.typewriter-ink');
  const phrase = 'what’s next.';
  await expect(page.getByRole('heading', {level:1})).toHaveAccessibleName('Every image. Made for what’s next.');
  const before = await word.boundingBox();
  await expect.poll(() => ink.textContent()).toBe(phrase);
  await expect.poll(() => ink.textContent(), {timeout:8000, intervals:[100]}).toBe('');
  await expect.poll(async () => (await ink.textContent()).length).toBeGreaterThan(0);
  const after = await word.boundingBox();
  expect(Math.abs(before.width-after.width)).toBeLessThan(1);
  expect(Math.abs(before.height-after.height)).toBeLessThan(1);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(ink).toHaveText(phrase);
  await expect(word).toHaveCSS('color', 'rgb(45, 108, 134)');
  await expect(page.locator('h1')).toHaveCSS('color', 'rgb(20, 22, 27)');
});

test('hero photos enter from opposite sides and above once, then settle', async ({ page }) => {
  // Slow only the artwork entrance so every frame can be inspected under CI load.
  // Finish each animation explicitly below; production timing remains unchanged.
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.hero-tile')) animation.playbackRate = 0.05;
      return animation;
    };
  });
  await page.goto('/');
  const tiles = page.locator('.hero-tile');
  const sources = await tiles.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  const rotations = await tiles.evaluateAll(elements => elements.map(el => getComputedStyle(el).transform));
  for (const [index, tile] of (await page.locator('.hero-tile:visible').all()).entries()) {
    await tile.evaluate(el => el.scrollIntoView({behavior:'instant', block:'center'}));
    await expect.poll(() => tile.evaluate(el => el.getAnimations().length)).toBe(1);
    const frames = await tile.evaluate(el => {
      const animation = el.getAnimations()[0];
      animation.pause();
      return animation.effect.getKeyframes();
    });
    expect(frames[0].translate).toMatch(index === 0 ? /^-/ : index === 1 ? /^0px -/ : /^[1-9]/);
    if (index === 1) expect(Number(frames[0].opacity)).toBe(0);
    await tile.evaluate(el => el.getAnimations()[0].finish());
    await expect(tile).toHaveCSS('translate', 'none');
    await expect(tile).toHaveCSS('opacity', '1');
  }
  expect(await tiles.evaluateAll(elements => elements.map(el => getComputedStyle(el).transform))).toEqual(rotations);
  expect(await tiles.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')))).toEqual(sources);
  await page.evaluate(() => window.scrollTo({top:0, behavior:'instant'}));
  await page.locator('.hero-tile:visible').last().scrollIntoViewIfNeeded();
  expect(await tiles.evaluateAll(elements => elements.every(el => el.getAnimations().length === 0))).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();
  await page.locator('.hero-tile:visible').last().scrollIntoViewIfNeeded();
  expect(await tiles.evaluateAll(elements => elements.every(el => getComputedStyle(el).translate === 'none' && getComputedStyle(el).opacity === '1' && el.getAnimations().length === 0))).toBe(true);
});

test('hero typing is italic and regular weight with square buttons and outlined sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1 em')).toHaveCSS('font-style', 'italic');
  await expect(page.locator('h1 em')).toHaveCSS('font-weight', '400');
  const signIn = page.locator('.public-header-actions > a').first();
  await expect(signIn).toHaveCSS('border-top-style', 'solid');
  await expect(signIn).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  for(const control of await page.locator('button, .public-button, .public-header-actions > a').all()) {
    await expect(control).toHaveCSS('border-top-left-radius', '0px');
  }
});
