import { test, expect } from "@playwright/test";
test("new signup has accessible fields, safe password visibility and genuine email verification state", async ({
  page,
}, info) => {
  await page.route("**/api/auth/signup", (route) =>
    route.fulfill({
      status: 202,
      json: { message: "Check your email to confirm your account." },
    }),
  );
  await page.goto("/account/signup?next=checkout");
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeHidden();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("studio@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a-safe-long-passphrase");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "a-safe-long-passphrase",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".auth-success")).toContainText("Check your email");
  await expect(page).toHaveURL(/signup\?next=checkout/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/redesign-signup-${info.project.name}.png`,
    fullPage: true,
  });
});
test("recovery preserves checkout navigation and reset uses the existing password endpoint", async ({
  page,
}) => {
  await page.goto("/account/signin?next=checkout");
  await page
    .getByRole("link", { name: "Forgot password?", exact: true })
    .click();
  await expect(page).toHaveURL(/recover\?next=checkout/);
  await page.route("**/api/auth/recover", (route) =>
    route.fulfill({
      status: 202,
      json: {
        message:
          "If an account exists, a password recovery email will be sent.",
      },
    }),
  );
  await page
    .getByLabel("Email address", { exact: true })
    .fill("studio@example.com");
  await page.getByRole("button", { name: "Send recovery email" }).click();
  await expect(page.locator(".auth-success")).toContainText(
    "If an account exists",
  );
  let request;
  await page.route("**/api/auth/password", (route) => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/account/reset");
  await page
    .getByLabel("Password", { exact: true })
    .fill("new-safe-long-passphrase");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/account\/signin$/);
  expect(request).toEqual({ password: "new-safe-long-passphrase" });
});
test("Google appears only on provider capability and safely reports initiation failure", async ({
  page,
}) => {
  await page.route("**/api/public/auth", (route) =>
    route.fulfill({ json: { google: true } }),
  );
  await page.route("**/api/auth/google", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          message: "Google sign-in could not start. Use email and password.",
        },
      },
    }),
  );
  await page.goto("/account/signin");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator("#auth-provider-notice")).toContainText(
    "could not start",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/\/account\/signin$/);
  await page.goto("/account/signin?auth_error=google");
  await expect(page.getByRole("alert")).toContainText(
    "cancelled, expired or could not be verified",
  );
  await expect(page).toHaveURL(/\/account\/signin$/);
});
test("legal destinations display the requested titles without pretending final policies exist", async ({
  page,
}) => {
  for (const [path, title] of Object.entries({
    terms: "Terms & Conditions",
    privacy: "Privacy Policy",
    cookies: "Cookie Policy",
    legal: "Legal Information",
  })) {
    await page.goto(`/${path}`);
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(page.locator(".legal-review")).toContainText(
      "Document not yet published",
    );
    await expect(page.locator(".footer-bottom")).toContainText(
      "All rights reserved © 2026 SonkoFlow, a product of AaronPrime PTY LTD.",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
});
