import { test, expect } from "@playwright/test";
test("account shell renders without horizontal overflow and keeps landing page intact", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/account/signin");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to SONKOFLOW" }).click();
  await expect(
    page.getByRole("heading", { name: /Product photography/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("unconfigured sign-in reports a real service error rather than success", async ({
  page,
}) => {
  await page.goto("/account/signin");
  await page.getByLabel("Email address").fill("test@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-password-for-test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("not configured");
  await expect(page).toHaveURL(/account\/signin/);
});
test("protected application redirects, and incomplete confirmations remain errors", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/account/confirm");
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "missing its confirmation token",
  );
});
