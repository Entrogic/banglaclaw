import { expect, test } from "@playwright/test";
import { e2eState } from "../src/state.js";

test.describe("website widget", () => {
  test("opens from the bubble on a customer site and answers without showing tool details", async ({ page }) => {
    const { baseUrl } = e2eState();
    const port = new URL(baseUrl).port;
    await page.goto(`http://localhost:${port}/e2e/host.html`);

    const bubble = page.locator("[data-banglaclaw-widget] .bubble");
    await expect(bubble).toBeVisible();
    await bubble.click();
    await expect(bubble).toHaveAttribute("aria-expanded", "true");

    const frame = page.frameLocator("[data-banglaclaw-widget] iframe");
    await expect(frame.locator("#title")).toHaveText("Dokan সহায়তা");
    await expect(frame.locator(".msg.bot").first()).toContainText("আসসালামু আলাইকুম");

    await frame.getByLabel("বার্তা").fill("6 * 7 কত?");
    await frame.getByLabel("বার্তা").press("Enter");
    await expect(frame.locator(".msg.user").last()).toHaveText("6 * 7 কত?");
    await expect(frame.locator(".msg.bot").last()).toContainText("42");
    await expect(frame.locator("body")).not.toContainText("calculator");

    // Close from inside the frame; the bubble takes over again.
    await frame.getByRole("button", { name: "বন্ধ করুন" }).click();
    await expect(bubble).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps the conversation when the visitor comes back", async ({ page }) => {
    const port = new URL(e2eState().baseUrl).port;
    await page.goto(`http://localhost:${port}/e2e/host.html`);
    await page.locator("[data-banglaclaw-widget] .bubble").click();
    const frame = page.frameLocator("[data-banglaclaw-widget] iframe");
    await frame.getByLabel("বার্তা").fill("mone rakhben");
    await frame.getByLabel("বার্তা").press("Enter");
    await expect(frame.locator(".msg.bot").last()).toContainText("আপনি লিখেছেন: mone rakhben");

    await page.reload();
    await page.locator("[data-banglaclaw-widget] .bubble").click();
    await expect(page.frameLocator("[data-banglaclaw-widget] iframe").locator(".msg.user")).toHaveText(["mone rakhben"]);
  });

  test("may only be embedded by the allowed sites", async ({ request }) => {
    const { baseUrl } = e2eState();
    const res = await request.get("/widget/frame");
    expect(res.headers()["content-security-policy"]).toContain(`frame-ancestors http://localhost:${new URL(baseUrl).port}`);
    expect(res.headers()["x-frame-options"]).toBeUndefined();
  });
});
