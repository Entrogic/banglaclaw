import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@banglaclaw/source"] },
  ssr: { resolve: { conditions: ["@banglaclaw/source"] } },
  test: { include: ["test/**/*.test.{ts,tsx}"] },
});
