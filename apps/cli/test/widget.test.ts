import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "@entrogic-net/shared";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWidget } from "../src/widget.js";

function loaded(yaml: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bc-widget-"));
  writeFileSync(join(dir, "banglaclaw.yaml"), yaml);
  return loadConfig({ cwd: dir, env });
}

const on = "channels:\n  widget:\n    enabled: true\n    allowedOrigins: [https://shop.example.com]\n";

describe("resolveWidget", () => {
  it("is off by default", () => {
    expect(resolveWidget(loaded(""))).toEqual({ warnings: [] });
  });

  it("requires allowed origins and a strong secret", () => {
    expect(() => resolveWidget(loaded("channels:\n  widget:\n    enabled: true\n"))).toThrow(ConfigError);
    expect(() => resolveWidget(loaded(on, { BANGLACLAW_WIDGET_SECRET: "short" }))).toThrow(/at least 32/);
  });

  it("uses the configured secret, or a random one with a warning", () => {
    const secret = "s".repeat(40);
    const configured = resolveWidget(loaded(`gateway:\n  trustProxy: true\n${on}`, { BANGLACLAW_WIDGET_SECRET: secret }));
    expect(configured).toEqual({ options: expect.objectContaining({ secret, allowedOrigins: ["https://shop.example.com"], title: "BanglaClaw" }), warnings: [] });

    const generated = resolveWidget(loaded(on));
    expect(generated.options?.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.warnings).toEqual([expect.stringContaining("BANGLACLAW_WIDGET_SECRET"), expect.stringContaining("trustProxy")]);
  });
});
