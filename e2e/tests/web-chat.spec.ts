import { expect, test } from "@playwright/test";
import { e2eState } from "../src/state.js";

test.describe("web chat (/chat)", () => {
  test("connects with a key, streams a markdown reply with a folded tool card, and keeps history", async ({ page }, info) => {
    const { userKey } = e2eState();
    await page.goto("/chat");
    await expect(page.getByRole("heading", { name: "Connect to BanglaClaw" })).toBeVisible();
    await page.getByLabel("API key", { exact: true }).fill(userKey);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.locator("#status")).toHaveText("connected");
    await expect(page.locator(".hero")).toContainText("আসসালামু আলাইকুম");

    const question = `${info.project.name} 25 * 4 কত?`;
    await page.getByLabel("Message").fill(question);
    await page.getByLabel("Message").press("Enter");

    const reply = page.locator(".turn.assistant").last();
    await expect(reply.locator(".md table")).toContainText("100");
    await expect(reply.locator(".md strong")).toHaveText("উত্তর:");
    await expect(reply.locator(".worked > summary")).toContainText(/Worked for .* · 1 tool/);
    await reply.locator(".worked > summary").click();
    await expect(reply.locator(".tool .tname")).toHaveText("calculator");
    await expect(page.locator("#info")).toContainText("tokens");

    // The session title (first message) labels the conversation in the header and the sidebar.
    await expect(page.locator("#title")).toHaveText(question);
    if (info.project.name === "mobile") await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(page.locator(".srow.active .title")).toHaveText(question);

    await page.reload();
    await expect(page.locator(".turn.user .bubble").first()).toHaveText(question);
    await expect(page.locator(".turn.assistant .worked > summary")).toContainText("Used 1 tool");

    await page.getByLabel("Message").fill("/new");
    await page.getByLabel("Message").press("Enter");
    await expect(page.locator(".hero")).toBeVisible();
    await expect(page.locator("#title")).toHaveText("New chat");
  });

  test("offers slash commands and switches the theme", async ({ page }) => {
    const { userKey } = e2eState();
    await page.goto("/chat");
    await page.getByLabel("API key", { exact: true }).fill(userKey);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.locator("#status")).toHaveText("connected");

    await page.getByLabel("Message").fill("/");
    await expect(page.locator("#menu li")).toHaveText([/\/new/, /\/sessions/, /\/theme/, /\/logout/]);
    await page.getByLabel("Message").fill("/theme");
    await page.getByLabel("Message").press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
