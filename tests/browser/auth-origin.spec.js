import { test, expect } from "@playwright/test";
async function fixture(
  page,
  { scenario = "retry", kind = "google", proofAvailable = true } = {},
) {
  const state = { attempts: [], proofs: 0, accepted: 0 };
  const token = `${Math.floor(Date.now() / 1000) + 600}.${"a".repeat(64)}.${"b".repeat(64)}`;
  await page.route("**/api/public/auth", (r) =>
    r.fulfill({ json: { google: true } }),
  );
  await page.route("**/api/public/auth-request", (r) => {
    state.proofs++;
    return proofAvailable
      ? r.fulfill({
          headers: {
            "cache-control": "no-store",
            "set-cookie": `sonkoflow_auth_request=${token}; Path=/; HttpOnly; SameSite=Strict`,
          },
          json: { token },
        })
      : r.fulfill({
          status: 503,
          json: { error: { message: "Verification unavailable" } },
        });
  });
  await page.route(`**/api/auth/${kind}`, async (route) => {
    const headers = await route.request().allHeaders(),
      body = route.request().postDataJSON();
    state.attempts.push({ headers, body });
    if (scenario === "other-error")
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "provider_unavailable",
            message: "Provider unavailable",
          },
        },
      });
    if (scenario === "forbidden")
      return route.fulfill({
        status: 403,
        json: { error: { code: "forbidden", message: "Action unavailable" } },
      });
    if (
      scenario === "rejected" ||
      (scenario === "retry" && state.attempts.length === 1)
    )
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: "invalid_origin",
            message: "Request origin is not allowed.",
          },
        },
      });
    if (scenario === "retry") {
      expect(headers["x-sonkoflow-auth-request"]).toBe(token);
      expect(headers.cookie).toContain(`sonkoflow_auth_request=${token}`);
    }
    state.accepted++;
    return route.fulfill({
      json:
        kind === "google"
          ? {
              url: "https://ednpufjlvuhxfbyiukih.supabase.co/auth/v1/authorize?provider=google",
            }
          : { message: "Check your email to confirm your account." },
    });
  });
  await page.route("https://ednpufjlvuhxfbyiukih.supabase.co/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Authorization handoff fixture</h1>",
    }),
  );
  await page.goto("/account/signup");
  return state;
}
test("Google signup recovers one origin rejection with signed-cookie proof and reaches the authorization handoff", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    page.getByRole("heading", { name: "Authorization handoff fixture" }),
  ).toBeVisible();
  expect(state.attempts).toHaveLength(2);
  expect(state.proofs).toBe(1);
  expect(state.accepted).toBe(1);
  expect(state.attempts[0].body).toEqual(state.attempts[1].body);
});
test("normal Google initiation remains a single request without a verification round trip", async ({
  page,
}) => {
  const state = await fixture(page, { scenario: "normal" });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    page.getByRole("heading", { name: "Authorization handoff fixture" }),
  ).toBeVisible();
  expect(state.attempts).toHaveLength(1);
  expect(state.proofs).toBe(0);
  expect(state.accepted).toBe(1);
});
test("email signup retries only the rejected request and preserves the exact submitted credentials", async ({
  page,
}) => {
  const state = await fixture(page, { kind: "signup" });
  await page.getByLabel("Email address").fill("signup-fixture@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fixture-only-long-passphrase");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /Check your email/ }),
  ).toBeVisible();
  expect(state.attempts).toHaveLength(2);
  expect(state.proofs).toBe(1);
  expect(state.accepted).toBe(1);
  expect(state.attempts[0].body).toEqual(state.attempts[1].body);
});
for (const scenario of ["other-error", "forbidden"])
  test(`${scenario} does not trigger verification or automatically replay an authentication action`, async ({
    page,
  }) => {
    const state = await fixture(page, { scenario });
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.locator("#auth-provider-notice")).toContainText(
      scenario === "other-error"
        ? "Provider unavailable"
        : "Action unavailable",
    );
    expect(state.attempts).toHaveLength(1);
    expect(state.proofs).toBe(0);
    expect(state.accepted).toBe(0);
  });
test("a continuing origin rejection stops after one verified retry with no loop or fabricated signup success", async ({
  page,
}) => {
  const state = await fixture(page, { scenario: "rejected" });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator("#auth-provider-notice")).toContainText(
    "Request origin is not allowed",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  expect(state.attempts).toHaveLength(2);
  expect(state.proofs).toBe(1);
  expect(state.accepted).toBe(0);
});
test("unavailable same-site verification fails closed and leaves the account action available for an explicit retry", async ({
  page,
}) => {
  const state = await fixture(page, { proofAvailable: false });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator("#auth-provider-notice")).toContainText(
    "Request origin is not allowed",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  expect(state.attempts).toHaveLength(1);
  expect(state.proofs).toBe(1);
  expect(state.accepted).toBe(0);
});
