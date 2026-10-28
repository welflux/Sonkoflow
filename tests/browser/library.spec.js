import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const project = "11111111-1111-4111-8111-111111111111",
  image = "22222222-2222-4222-8222-222222222222",
  job = "33333333-3333-4333-8333-333333333333",
  pack = "44444444-4444-4444-8444-444444444444",
  batch = "55555555-5555-4555-8555-555555555555";
async function fixture(page) {
  const photo = await readFile("public/images/footwear-small.webp"),
    state = { actions: [], queries: [], projects: [] };
  let trashed = false;
  await page.route("**/app/**", async (r) =>
    r.fulfill({ response: await page.request.get("/account/signin") }),
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let body = {};
    if (path === "/api/session")
      body = { profile: { display_name: "Owner", audience: "ecommerce" } };
    else if (path === "/api/library/capabilities")
      body = { available: true, retention_days: 30 };
    else if (path === "/api/library/projects")
      body = {
        projects: [{ id: project, name: "Collection", archived: false }],
      };
    else if (path === "/api/library") {
      state.queries.push(url.searchParams.toString());
      const trash = url.searchParams.get("trash") === "1";
      body = {
        images:
          (trashed && !trash) || (!trashed && trash)
            ? []
            : [
                {
                  id: image,
                  filename: "Linen.webp",
                  role: "original",
                  width: 1024,
                  height: 768,
                  created_at: "2026-10-28T00:00:00Z",
                  library_project_id: project,
                  project_name: "Collection",
                  image_status: "ready",
                  mode: "product",
                  processing_status: "completed",
                  quality_state: "completed",
                  user_decision: "approved",
                  pack_id: pack,
                  batch_id: batch,
                  trashed_at: trashed ? "2026-10-28T00:00:00Z" : null,
                },
              ],
        next_offset: null,
      };
    } else if (path === "/api/library/actions") {
      const b = route.request().postDataJSON();
      state.actions.push(b);
      if (b.action === "trash") trashed = true;
      if (b.action === "restore") trashed = false;
      body = { updated: 1 };
    } else if (path === `/api/library/${image}/history`)
      body = {
        jobs: [
          {
            id: job,
            mode: "product",
            status: "completed",
            quality_state: "completed",
            user_decision: "approved",
            created_at: "2026-10-28T00:00:00Z",
            pack_id: pack,
          },
        ],
        next_offset: null,
      };
    else if (path.endsWith("/thumbnail") || path.endsWith("/content"))
      return route.fulfill({ body: photo, contentType: "image/webp" });
    else if (path.startsWith("/api/library/projects/"))
      state.projects.push(route.request().postDataJSON());
    return route.fulfill({ json: body });
  });
  return state;
}
test("Library grid/list, filters, selection, move, trash and recovery use persisted API actions", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/app/library");
  await expect(
    page.getByRole("heading", { name: "Image library." }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/phase7-library-${test.info().project.name}.png`,
  });
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.locator("#library-results")).toHaveClass("library-list");
  if (!(await page.locator(".library-filter-panel").evaluate((n) => n.open)))
    await page.getByText("Search & filters", { exact: true }).click();
  await page.getByLabel("Search images or projects").fill("linen");
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await expect.poll(() => s.queries.at(-1)).toContain("search=linen");
  await page.getByLabel("Select Linen.webp").check();
  await expect(page.locator("#library-count")).toHaveText("1 selected");
  await page
    .getByRole("button", { name: "Move selected", exact: true })
    .click();
  await expect.poll(() => s.actions.length).toBe(1);
  expect(s.actions[0]).toMatchObject({ action: "move", value: null });
  await page.getByLabel("Select Linen.webp").check();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Trash selected", exact: true })
    .click();
  await expect(page.locator(".library-card")).toHaveCount(0);
  await page.getByLabel("Recovery bin", { exact: true }).check();
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await page.getByLabel("Select Linen.webp").check();
  await page
    .getByRole("button", { name: "Restore selected", exact: true })
    .click();
  await expect.poll(() => s.actions.at(-1).action).toBe("restore");
});
test("Preview loads full image on demand and preserves version, pack and batch navigation", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/app/library");
  await expect(page.locator(".library-card img")).toHaveAttribute(
    "src",
    `/api/library/${image}/thumbnail`,
  );
  await expect(page.locator(`a[href="/app/packs/${pack}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/app/batches/${batch}"]`)).toBeVisible();
  await page.getByRole("button", { name: "Preview & versions" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await expect(page.locator(`a[href="/app/edits/${job}"]`)).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => innerWidth),
  );
});
