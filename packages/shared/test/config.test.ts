import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/index.js";

function tempDir(yaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "banglaclaw-config-"));
  if (yaml !== undefined) writeFileSync(join(dir, "banglaclaw.yaml"), yaml);
  return dir;
}

describe("loadConfig", () => {
  it("returns safe defaults without a config file", () => {
    const { config, secrets, source } = loadConfig({ cwd: tempDir(), env: {} });
    expect(source).toBeUndefined();
    expect(config.models.default).toEqual({ provider: "openai-compatible", model: "gpt-4o-mini" });
    expect(config.runtime).toEqual({ maxIterations: 6, maxToolCalls: 8, timeoutMs: 60_000 });
    expect(config.tools.allow).toEqual(["calculator", "current_datetime"]);
    expect(config.timezone).toBe("Asia/Dhaka");
    expect(config.storage).toEqual({ provider: "memory", checkpoints: true });
    expect(config.memory.maxHistoryMessages).toBe(20);
    expect(config.skills).toEqual({ dirs: ["skills"], maxActive: 2 });
    expect(secrets).toEqual({});
  });

  it("reads YAML and applies env overrides", () => {
    const cwd = tempDir(
      "models:\n  default:\n    provider: openai-compatible\n    model: gpt-4o\nruntime:\n  maxToolCalls: 2\n",
    );
    const { config, secrets } = loadConfig({
      cwd,
      env: { BANGLACLAW_MODEL: "deepseek-chat", BANGLACLAW_BASE_URL: "https://api.deepseek.com/v1", OPENAI_API_KEY: "sk-test" },
    });
    expect(config.models.default).toEqual({
      provider: "openai-compatible",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
    });
    expect(config.runtime.maxToolCalls).toBe(2);
    expect(secrets.openaiApiKey).toBe("sk-test");
  });

  it("keeps the default provider when only model/baseUrl come from env", () => {
    const { config } = loadConfig({
      cwd: tempDir(),
      env: { BANGLACLAW_MODEL: "qwen2.5", BANGLACLAW_BASE_URL: "http://localhost:11434/v1" },
    });
    expect(config.models.default).toEqual({ provider: "openai-compatible", model: "qwen2.5", baseUrl: "http://localhost:11434/v1" });
  });

  it("drops the file's model when env switches provider", () => {
    const cwd = tempDir("models:\n  default:\n    provider: openai-compatible\n    model: gpt-4o\n");
    const { config } = loadConfig({ cwd, env: { BANGLACLAW_PROVIDER: "anthropic" } });
    expect(config.models.default).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
  });

  it("selects postgres storage from env and reads DATABASE_URL as a secret", () => {
    const cwd = tempDir("storage:\n  checkpoints: false\n");
    const { config, secrets, baseDir } = loadConfig({
      cwd,
      env: { BANGLACLAW_STORAGE: "postgres", DATABASE_URL: "postgres://u:p@localhost/db" },
    });
    expect(config.storage).toEqual({ provider: "postgres", checkpoints: false });
    expect(secrets.databaseUrl).toBe("postgres://u:p@localhost/db");
    expect(baseDir).toBe(cwd);
  });

  it("rejects an unknown provider", () => {
    expect(() => loadConfig({ cwd: tempDir(), env: { BANGLACLAW_PROVIDER: "nope" } })).toThrow(ConfigError);
  });

  it("does not accept API keys in the config file", () => {
    const cwd = tempDir("models:\n  default:\n    provider: anthropic\n    apiKey: sk-leak\n");
    expect(() => loadConfig({ cwd, env: {} })).toThrow(/apiKey/);
  });

  it("fails loudly when an explicit config path is missing", () => {
    expect(() => loadConfig({ cwd: tempDir(), path: "missing.yaml", env: {} })).toThrow(ConfigError);
  });
});
