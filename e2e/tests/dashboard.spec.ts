import { expect, test } from "@playwright/test";
import { e2eState } from "../src/state.js";

test.describe("admin dashboard (/admin)", () => {
  test.skip(() => !e2eState().dashboard, "apps/dashboard is not built (run pnpm build)");

  test("signs in, shows analytics and opens a session by its title", async ({ page, request }) => {
    const { userKey, adminKey } = e2eState();
    const title = `dashboard ${Date.now()} 12 * 3?`;
    const run = await request.post("/v1/agents/run", { headers: { Authorization: `Bearer ${userKey}` }, data: { text: title } });
    expect(run.ok()).toBe(true);

    await page.goto("/admin/");
    await page.getByLabel("API key").fill(adminKey);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.locator(".stat-label").filter({ hasText: /^Runs$/ })).toBeVisible();

    await page.getByRole("link", { name: "Sessions" }).click();
    await page.getByLabel("Search sessions").fill(title);
    const row = page.locator("tbody tr").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(page.locator("dd").filter({ hasText: title })).toBeVisible();
    await expect(page.locator(".transcript")).toContainText("36");
  });

  test("switches between light and dark themes", async ({ page }) => {
    await page.goto("/admin/");
    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "System theme" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  });
});
