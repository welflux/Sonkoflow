import { test, expect } from "@playwright/test";
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
async function fixture(page, options = {}) {
  const state = {
    posts: [],
    errors: [],
    rows: options.empty
      ? []
      : [
          {
            id: ids[0],
            name: "Autumn collection",
            audience: "ecommerce",
            archived: false,
            created_at: "2026-10-01T00:00:00Z",
            metadata_available: true,
            asset_count: 142,
            last_activity_at: "2026-10-29T12:00:00Z",
            activity_kind: "operation",
            last_operation: {
              id: ids[1],
              mode: "product",
              status: "completed",
              brand: { name: "Aster studio", revision: 3 },
            },
          },
          {
            id: ids[1],
            name: "Portrait campaign",
            audience: "professional",
            archived: false,
            created_at: "2026-10-02T00:00:00Z",
            metadata_available: true,
            asset_count: 4,
            last_activity_at: "2026-10-28T12:00:00Z",
            activity_kind: "upload",
            last_operation: null,
          },
          {
            id: ids[2],
            name: "Archived collection",
            audience: "individual",
            archived: true,
            created_at: "2026-10-03T00:00:00Z",
            metadata_available: true,
            asset_count: 2,
            last_activity_at: "2026-10-27T12:00:00Z",
            activity_kind: "created",
            last_operation: null,
          },
        ],
  };
  let failed = false;
  page.on("pageerror", (e) => state.errors.push(e.message));
  await page.route("**/app", async (r) =>
    r.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname,
      method = r.request().method();
    if (method === "POST")
      state.posts.push({ path, body: r.request().postDataJSON() });
    let body = {};
    if (path === "/api/session")
      body = { profile: { display_name: "Director", audience: "ecommerce" } };
    else if (path === "/api/projects/directory") {
      if (options.failLoad && !failed) {
        failed = true;
        return r.fulfill({
          status: 503,
          json: { error: { message: "Projects unavailable" } },
        });
      }
      body = {
        projects: state.rows.map((p) =>
          options.metadataFailure
            ? {
                ...p,
                metadata_available: false,
                asset_count: null,
                last_activity_at: null,
                last_operation: null,
              }
            : p,
        ),
      };
    } else if (path === "/api/projects" && method === "POST") {
      const b = r.request().postDataJSON();
      const p = {
        id: "44444444-4444-4444-8444-444444444444",
        ...b,
        archived: false,
        metadata_available: true,
        asset_count: 0,
        created_at: "2026-10-30T00:00:00Z",
        last_activity_at: "2026-10-30T00:00:00Z",
        activity_kind: "created",
        last_operation: null,
      };
      state.rows.push(p);
      body = { project: p };
    } else if (path.startsWith("/api/library/projects/")) {
      if (options.failAction)
        return r.fulfill({
          status: 409,
          json: { error: { message: "Project could not be changed" } },
        });
      const p = state.rows.find((p) => p.id === path.split("/").pop()),
        b = r.request().postDataJSON();
      if (b.action === "rename") p.name = b.value;
      else p.archived = b.action === "archive";
      body = { ok: true };
    } else
      return r.fulfill({
        status: 404,
        json: { error: { message: "Unexpected endpoint " + path } },
      });
    await r.fulfill({ json: body });
  });
  await page.goto("/app");
  return state;
}
async function actions(page, name = "Autumn collection") {
  const trigger = page.getByLabel(`Actions for ${name}`, { exact: true });
  await trigger.click();
  await expect(
    trigger.locator("..").locator(".project-action-menu"),
  ).toBeInViewport({ ratio: 1 });
}
test("directory uses real counts and brand history, scoped sidebar inset, responsive layouts and distinct grid/list controls", async ({
  page,
}) => {
  const s = await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Your projects", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".project-directory-card")).toHaveCount(2);
  await expect(page.locator("#projects-active")).toHaveText("2");
  await expect(page.locator("#projects-assets")).toHaveText("148");
  await expect(page.locator("#projects-archived")).toHaveText("1");
  await expect(page.getByText("Aster studio", { exact: true })).toBeVisible();
  await expect(page.locator("#project-editor")).not.toBeVisible();
  await expect(page.locator("#projects-grid")).toHaveCSS(
    "background-color",
    "rgb(20, 47, 62)",
  );
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator("#projects-results")).toHaveClass("projects-list");
  await expect(page.locator("#projects-list")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator("#projects-results")).toHaveClass("projects-grid");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  if (page.viewportSize().width > 1024) {
    const side = await page.locator(".sidebar").boundingBox(),
      active = await page
        .locator(".sidebar a[aria-current=page]")
        .boundingBox();
    expect(side.x + side.width - active.x - active.width).toBe(9);
    expect(
      await page
        .locator("#projects-results")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(3);
  }
  expect(s.posts).toEqual([]);
  expect(s.errors).toEqual([]);
});
test("project search, workflow/state filters and volume/name sorting operate on the directory", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.locator(".project-directory-card")).toHaveCount(2);
  await page.getByLabel("Sort projects", { exact: true }).selectOption("name");
  await expect(page.locator(".project-directory-card").first()).toContainText(
    "Autumn collection",
  );
  await page
    .getByLabel("Sort projects", { exact: true })
    .selectOption("volume");
  await expect(page.locator(".project-directory-card").first()).toContainText(
    "142",
  );
  await page.getByLabel("Search projects", { exact: true }).fill("PORTRAIT");
  await expect(page.locator(".project-directory-card")).toHaveCount(1);
  await page.getByLabel("Search projects", { exact: true }).fill("");
  await page
    .getByLabel("Workflow filter", { exact: true })
    .selectOption("ecommerce");
  await expect(page.locator(".project-directory-card")).toHaveCount(1);
  await page.getByLabel("Workflow filter", { exact: true }).selectOption("");
  await page
    .getByLabel("Project state", { exact: true })
    .selectOption("archived");
  await expect(page.locator(".project-directory-card")).toHaveCount(1);
  await expect(page.locator(".project-directory-card")).toContainText(
    "Archived collection",
  );
});
test("creation and rename use existing mutation endpoints and escape project names", async ({
  page,
}) => {
  const s = await fixture(page);
  await page
    .getByRole("button", { name: "+ New project", exact: true })
    .click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("New <collection>");
  await page.locator("#project-editor [type=submit]").click();
  await expect(page.locator("#project-editor")).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "New <collection>", exact: true }),
  ).toBeVisible();
  expect(s.posts[0]).toEqual({
    path: "/api/projects",
    body: { name: "New <collection>", audience: "ecommerce" },
  });
  await actions(page);
  await page
    .getByRole("button", { name: "Rename project", exact: true })
    .click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Autumn campaign");
  await page.locator("#project-editor [type=submit]").click();
  await expect(
    page.getByRole("link", { name: "Autumn campaign", exact: true }),
  ).toBeVisible();
  expect(s.posts.at(-1).body).toEqual({
    action: "rename",
    value: "Autumn campaign",
  });
  expect(s.errors).toEqual([]);
});
test("archive requires confirmation, restore is available, quick links preserve project context and exports are honest", async ({
  page,
}) => {
  const s = await fixture(page);
  await actions(page);
  await expect(
    page.getByRole("link", { name: "Prepare bulk batch ↗" }),
  ).toHaveAttribute("href", `/app/batches?project=${ids[0]}`);
  await page
    .getByRole("button", { name: "Production exports", exact: true })
    .click();
  await expect(page.locator("#project-exports")).toContainText(
    "A full-project archive is not available",
  );
  await expect(
    page.getByRole("link", { name: "Download individual assets ↗" }),
  ).toHaveAttribute("href", `/app/library?project_id=${ids[0]}`);
  await page.getByLabel("Close production exports").click();
  await actions(page);
  await page
    .getByRole("button", { name: "Archive project", exact: true })
    .click();
  expect(s.posts).toEqual([]);
  await page.locator("#project-confirm-action").click();
  await expect(page.locator(".project-directory-card")).toHaveCount(1);
  await page
    .getByLabel("Project state", { exact: true })
    .selectOption("archived");
  await actions(page);
  await page
    .getByRole("button", { name: "Restore project", exact: true })
    .click();
  await page.locator("#project-confirm-action").click();
  await expect(page.locator(".project-directory-card")).toHaveCount(1);
  expect(s.posts.map((p) => p.body.action)).toEqual(["archive", "restore"]);
});
test("empty, unavailable metadata and failed reads preserve honest states and retry", async ({
  page,
}) => {
  await fixture(page, { failLoad: true, metadataFailure: true });
  await expect(
    page.getByRole("heading", { name: "Projects could not be loaded" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Create your first project" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Retry loading projects" }).click();
  await expect(page.locator(".project-directory-card")).toHaveCount(2);
  await expect(page.locator("#projects-assets")).toHaveText("—");
  await expect(page.locator("#page-notice")).toContainText(
    "Some production metadata",
  );
  await expect(
    page.getByText("Metadata unavailable", { exact: true }),
  ).toHaveCount(2);
});
test("failed project actions keep the dialog and existing project records intact", async ({
  page,
}) => {
  const s = await fixture(page, { failAction: true });
  await actions(page);
  await page
    .getByRole("button", { name: "Rename project", exact: true })
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Changed");
  await page.locator("#project-editor [type=submit]").click();
  await expect(page.locator("#project-editor")).toBeVisible();
  await expect(page.locator("#project-editor [role=alert]")).toContainText(
    "could not be changed",
  );
  await expect(
    page.getByRole("link", { name: "Autumn collection", exact: true }),
  ).toBeVisible();
  expect(s.rows[0].name).toBe("Autumn collection");
});
test("new accounts get a project-first empty state without fabricated telemetry or automatic uploads", async ({
  page,
}) => {
  const s = await fixture(page, { empty: true });
  await expect(
    page.getByRole("heading", { name: "Create your first project" }),
  ).toBeVisible();
  await expect(page.locator("#projects-assets")).toHaveText("0");
  await expect(page.locator(".project-directory-card")).toHaveCount(0);
  await page.locator(".projects-empty button").click();
  await expect(page.locator("#project-editor")).toBeVisible();
  expect(s.posts).toEqual([]);
});
