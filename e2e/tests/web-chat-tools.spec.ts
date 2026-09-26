import { expect, test, type Page } from "@playwright/test";
import { e2eState } from "../src/state.js";

async function connect(page: Page) {
  await page.goto("/chat");
  await page.getByLabel("API key", { exact: true }).fill(e2eState().userKey);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.locator("#status")).toHaveText("connected");
}

async function ask(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByLabel("Message").press("Enter");
  await expect(page.locator("#dock")).not.toHaveClass(/running/);
}

async function openSidebar(page: Page) {
  if ((page.viewportSize()?.width ?? 1_000) <= 820) await page.getByRole("button", { name: "Show sidebar" }).click();
}

test.describe("web chat tools", () => {
  test("files panel: the agent's file can be previewed, restored from history, deleted and undone", async ({ page }, info) => {
    await connect(page);
    const name = `list-${info.project.name}-${Date.now()}.md`;
    await ask(page, `note: ${name}: # বাজার\n- চাল ৫ কেজি`);
    await ask(page, `note: ${name}: # বাজার\n- চাল ৫ কেজি\n- ডাল ২ কেজি`);

    await openSidebar(page);
    await page.getByRole("tab", { name: "Files" }).click();
    const row = page.locator(".frow").filter({ hasText: name });
    await row.click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.locator("#viewer-title")).toHaveText(`notes/${name}`);
    await expect(viewer.locator(".md h1")).toHaveText("বাজার");
    await expect(viewer.locator(".md li")).toHaveText(["চাল ৫ কেজি", "ডাল ২ কেজি"]);

    await viewer.getByRole("button", { name: "History" }).click();
    await viewer.locator(".version").first().getByRole("button", { name: "Restore" }).click();
    await expect(viewer.locator(".md li")).toHaveText(["চাল ৫ কেজি"]);

    page.once("dialog", (d) => void d.accept());
    await viewer.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".frow").filter({ hasText: name })).toHaveCount(0);
    await page.locator("#toast").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".frow").filter({ hasText: name })).toHaveCount(1);
  });

  test("attach: an uploaded file is announced to the agent with its workspace path", async ({ page }, info) => {
    await connect(page);
    const filename = `menu-${info.project.name}.csv`;
    await page.locator("#file").setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from("item,price\nচাল,৫০") });
    await expect(page.locator("#attachments .chip")).toContainText(`uploads/${filename}`);
    await ask(page, "eta dekho");
    await expect(page.locator(".turn.user .bubble").last()).toContainText(`uploads/${filename}`);
    await expect(page.locator("#attachments .chip")).toHaveCount(0);
  });

  test("sessions: rename, search and delete from the sidebar", async ({ page }, info) => {
    await connect(page);
    const unique = `rename-me-${info.project.name}-${Date.now()}`;
    await ask(page, unique);
    await openSidebar(page);
    const row = page.locator(".srow").filter({ hasText: unique });
    await row.hover();
    await row.getByRole("button", { name: `Rename ${unique}` }).click();
    const newName = `renamed ${unique}`;
    await page.getByLabel("New name").fill(newName);
    await page.getByLabel("New name").press("Enter");
    await expect(page.locator(".srow .title").filter({ hasText: newName })).toHaveCount(1);

    await page.getByLabel("Search conversations").fill(newName);
    await expect(page.locator("#sessions .srow")).toHaveCount(1);
    page.once("dialog", (d) => void d.accept());
    await page.locator(".srow").filter({ hasText: newName }).getByRole("button", { name: `Delete ${newName}` }).click();
    await expect(page.locator("#sessions")).toContainText("No conversations match.");
    await expect(page.locator("#title")).toHaveText("New chat");
  });

  test("message actions: copy a reply, retry the question, edit a message", async ({ page }) => {
    await connect(page);
    await ask(page, "5 * 5 কত?");
    const reply = page.locator(".turn.assistant").last();
    await reply.getByRole("button", { name: "Copy" }).click();
    await expect(page.locator("#toast")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("25");

    await reply.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("#dock")).not.toHaveClass(/running/);
    await expect(page.locator(".turn.user .bubble")).toHaveText(["5 * 5 কত?", "5 * 5 কত?"]);

    const mine = page.locator(".turn.user").first();
    await mine.hover();
    await mine.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Message")).toHaveValue("5 * 5 কত?");
  });

  test("microphone: a recording is transcribed into the composer", async ({ page }) => {
    await connect(page);
    const mic = page.getByRole("button", { name: "Record voice" });
    await expect(mic).toBeVisible();
    await mic.click();
    await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(page.getByLabel("Message")).toHaveValue(/ভয়েস থেকে লেখা \(audio\//);
  });
});
