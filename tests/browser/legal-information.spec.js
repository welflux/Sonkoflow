import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../content/legal/legal-information.txt", import.meta.url),
  "utf8",
);
const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

test("legal information preserves the supplied content, dates and accessible section navigation", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/legal");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-robots-tag"]).toBeUndefined();
  await expect(page.locator("h1")).toHaveText("Legal Information");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator(".terms-section")).toHaveCount(11);
  await expect(page.locator(".terms-index a")).toHaveCount(11);
  await expect(page.locator('time[datetime="2026-10-30"]')).toHaveCount(1);
  await expect(page.locator(".terms-dates")).toContainText("30 October 2026");
  const text = normalize(await page.locator("main").innerText());
  for (const line of source
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(2)) {
    if (/^\d+\. [A-Z]/.test(line)) continue;
    expect(text, `Missing supplied text: ${line}`).toContain(normalize(line));
  }
  expect(text).not.toMatch(
    /insert publication|insert revision|not yet published|will be added/,
  );
  await expect(page.locator(".operator-details > div")).toHaveCount(7);
  expect(text).not.toMatch(
    /registered business address|address for legal service|\[insert/i,
  );
  await expect(page.locator("#section-9")).toContainText(
    "General correspondence: hello@sonkoflow.com",
  );
  const mobile = info.project.use.viewport.width <= 760;
  if (mobile) await page.locator(".terms-index summary").click();
  await page.locator('.terms-index a[href="#section-11"]').click();
  await expect(page).toHaveURL(/#section-11$/);
  await expect
    .poll(() =>
      page.locator("#heading-11").evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        return bounds.top >= 70 && bounds.top < innerHeight;
      }),
    )
    .toBeTruthy();
  await expect(
    page.locator('.terms-index a[href="#section-11"]'),
  ).toHaveAttribute("aria-current", "location");
  for (const href of await page
    .locator('main a[href^="#"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
    expect(await page.locator(href).count(), href).toBe(1);
  }
  for (const path of ["/terms", "/privacy", "/cookies"]) {
    expect(
      await page.locator(`main a[href="${path}"]`).count(),
    ).toBeGreaterThan(0);
    expect((await page.request.get(path)).status()).toBe(200);
  }
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = true;
    };
  });
  await page.locator(".terms-print").click();
  expect(await page.evaluate(() => window.__printed)).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".terms-sidebar")).toBeHidden();
  await expect(page.locator(".public-header")).toBeHidden();
  await expect(page.locator("#section-11")).toBeVisible();
  expect(errors).toEqual([]);
});

test("legal information remains readable without scripts and fit narrow viewports", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4300/legal");
  await expect(page.locator("#section-11")).toContainText(
    "hello@sonkoflow.com",
  );
  await expect(page.locator(".terms-print")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator('.terms-index a[href="#section-1"]')).toBeVisible();
  await context.close();
});
