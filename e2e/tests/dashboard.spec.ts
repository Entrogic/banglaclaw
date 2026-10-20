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

  test("shows an eval run recorded through the API and its failed case", async ({ page, request }) => {
    const { adminKey } = e2eState();
    const name = `e2e-${Date.now()}`;
    const metric = (score: number, success: boolean, reason: string) => ({ name: "Answer Relevancy", score, threshold: 0.7, success, reason });
    const recorded = await request.post("/v1/admin/evals", {
      headers: { Authorization: `Bearer ${adminKey}` },
      data: {
        name,
        frameworkVersion: "4.3.1",
        cases: [
          { name: "multiply-bn", input: "৬ গুণ ৭ কত?", actualOutput: "৪২", metrics: [metric(0.95, true, "প্রাসঙ্গিক")] },
          { name: "capital-bn", input: "বাংলাদেশের রাজধানী?", actualOutput: "জানি না", metrics: [metric(0.2, false, "প্রশ্নের উত্তর দেয়নি")] },
        ],
      },
    });
    expect(recorded.status()).toBe(201);

    await page.goto("/admin/");
    await page.getByLabel("API key").fill(adminKey);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("link", { name: "Evals" }).click();
    const row = page.locator("tbody tr").filter({ hasText: name });
    await expect(row).toContainText("1/2 passed");
    await row.click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.locator(".stat").filter({ hasText: "Pass rate" })).toContainText("50%");
    await page.getByLabel("Failed only").check();
    await expect(page.locator(".eval-case")).toHaveCount(1);
    await page.locator(".eval-case summary").click();
    await expect(page.locator(".eval-case")).toContainText("প্রশ্নের উত্তর দেয়নি");
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
