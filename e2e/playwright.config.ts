import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4319);

/**
 * Browser tests against a real gateway (src/server.ts) with a deterministic fake model.
 * Build first (`pnpm build`) so the dashboard is served. PW_CHANNEL=chrome uses an installed
 * Chrome instead of Playwright's Chromium (`pnpm --filter @entrogic-net/e2e exec playwright install chromium`).
 */
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 1 : 0,
  reporter: process.env.CI !== undefined ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "bn-BD",
    trace: "retain-on-failure",
    permissions: ["microphone", "clipboard-read", "clipboard-write"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
    ...(process.env.PW_CHANNEL !== undefined && { channel: process.env.PW_CHANNEL }),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /widget|web-chat/ },
  ],
  webServer: {
    command: "node --import tsx --conditions=@banglaclaw/source src/server.ts",
    url: `http://127.0.0.1:${port}/health`,
    env: { E2E_PORT: String(port) },
    reuseExistingServer: process.env.CI === undefined,
    stdout: "pipe",
    timeout: 60_000,
  },
});
