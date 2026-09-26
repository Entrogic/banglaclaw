import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@entrogic-net/shared";
import { loadPlugins } from "../src/plugins.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

function configWith(plugins: string[], dir = mkdtempSync(join(tmpdir(), "banglaclaw-plugins-"))) {
  writeFileSync(join(dir, "banglaclaw.yaml"), `plugins: ${JSON.stringify(plugins)}\n`);
  return loadConfig({ cwd: dir, env: {} });
}

describe("loadPlugins", () => {
  it("loads the example bd-phone plugin with its tool and skills dir", async () => {
    const [loaded] = await loadPlugins(configWith([join(REPO, "examples/plugins/bd-phone")]));
    expect(loaded?.plugin).toMatchObject({ name: "bd-phone", version: "1.0.0", apiVersion: 1 });
    const tool = loaded?.plugin.tools?.[0];
    expect(tool?.name).toBe("validate_bd_phone");
    const ctx = { runId: "r", sessionId: "s", timezone: "Asia/Dhaka", signal: new AbortController().signal };
    expect(await tool?.execute({ number: "+৮৮০১৭১২-৩৪৫৬৭৮" }, ctx)).toEqual({ valid: true, input: "+৮৮০১৭১২-৩৪৫৬৭৮", local: "01712345678", international: "+8801712345678", operator: "Grameenphone" });
    expect(await tool?.execute({ number: "01212345678" }, ctx)).toMatchObject({ valid: false });
    expect(loaded?.plugin.skillsDirs?.[0]).toBe(join(REPO, "examples/plugins/bd-phone/skills"));
  });

  it("rejects bad plugins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "banglaclaw-plugins-"));
    mkdirSync(join(dir, "p"));
    writeFileSync(join(dir, "p/bad.mjs"), "export default { name: 'Bad Name' };\n");
    writeFileSync(join(dir, "p/future.mjs"), "export default { name: 'future', version: '1.0.0', apiVersion: 99 };\n");
    await expect(loadPlugins(configWith(["./p/bad.mjs"], dir))).rejects.toThrow(/definePlugin/);
    await expect(loadPlugins(configWith(["./p/future.mjs"], dir))).rejects.toThrow(/plugin API v99/);
    await expect(loadPlugins(configWith(["./p/missing.mjs"], dir))).rejects.toThrow(/Cannot load plugin/);
    await expect(loadPlugins(configWith(["./p/future.mjs", "./p/future.mjs"], dir))).rejects.toThrow(/plugin API|twice/);
  });
});
