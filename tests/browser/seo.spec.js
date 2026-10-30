import { test, expect } from "@playwright/test";
import { allPages, featurePages, origin } from "../../content/seo-pages.mjs";
for (const info of allPages) {
  test(`public SEO metadata and semantic delivery: ${info.path}`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(info.path);
    await expect(page).toHaveTitle(info.title);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
      "href",
      origin + info.path,
    );
    await expect(page.locator("meta[name=description]")).toHaveAttribute(
      "content",
      info.description,
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      origin + info.path,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    const graph = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    expect(
      JSON.parse(graph)["@graph"].some(
        (n) => n["@type"] === "SoftwareApplication",
      ),
    ).toBeTruthy();
    if (
      info.path.startsWith("/features/") ||
      info.path.startsWith("/solutions/")
    ) {
      await expect(page.locator(".seo-hero img")).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator(".seo-hero img")
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        )
        .toBeTruthy();
      await expect(page.locator(".seo-related a")).toHaveCount(3);
      const faq = page.locator(".seo-faq summary").first();
      await faq.click();
      await expect(page.locator(".seo-faq details").first()).toHaveAttribute(
        "open",
        "",
      );
      await expect(
        page
          .getByRole("link", { name: "Create your workspace ↗", exact: true })
          .first(),
      ).toHaveAttribute("href", "/account/signup");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(errors).toEqual([]);
  });
}
test("public feature routes are discoverable through real links and retain keyboard/mobile navigation", async ({
  page,
}) => {
  await page.goto("/");
  for (const info of featurePages)
    expect(
      await page.locator(`a[href="${info.path}"]`).count(),
    ).toBeGreaterThan(0);
  const menu = page.getByRole("button", { name: /menu/i });
  if (await menu.isVisible()) await menu.click();
  const resources = page.locator(".nav-resources").first();
  await resources.locator("summary").click();
  const target = resources.getByRole("link", {
    name: "Bulk editing",
    exact: true,
  });
  await target.click();
  await expect(page).toHaveURL(/\/features\/bulk-image-processing$/);
  await expect(page.locator("h1")).toContainText("Bulk AI image enhancement");
  await page
    .getByRole("link", { name: "Compare plans and allowances ↗", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pricing#plans$/);
  await expect(page.locator("#plans")).toBeInViewport();
});
