import react from "@vitejs/plugin-react";
import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";

// Dev: `pnpm --filter @banglaclaw/dashboard dev` proxies /v1 to a running gateway (`banglaclaw serve`).
const gateway = process.env.BANGLACLAW_GATEWAY_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  resolve: { conditions: ["@banglaclaw/source", ...defaultClientConditions] },
  server: { proxy: { "/v1": gateway } },
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"], env: { BASE_URL: "/admin/" } },
});
