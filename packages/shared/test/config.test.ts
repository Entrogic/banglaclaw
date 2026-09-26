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
    expect(config.tools.allow).toEqual(["calculator", "current_datetime", "search_knowledge", "remember", "recall", "forget"]);
    expect(config.timezone).toBe("Asia/Dhaka");
    expect(config.storage).toEqual({ provider: "memory", checkpoints: true });
    expect(config.memory.maxHistoryMessages).toBe(20);
    expect(config.skills).toEqual({ dirs: ["skills"], builtin: true, maxActive: 2 });
    expect(config.mcp).toEqual({ servers: {} });
    expect(config.gateway).toEqual({
      host: "127.0.0.1", port: 3000, corsOrigins: [], maxInputChars: 8000, trustProxy: false, metrics: true,
      rateLimit: { requestsPerMinute: 60, maxConcurrentRuns: 2 },
    });
    expect(config.channels.telegram).toEqual({ enabled: false, mode: "polling", access: "allowlist", allowedUserIds: [], rateLimitPerMinute: 10, liveReplies: true });
    expect(config.channels.whatsapp).toMatchObject({ enabled: false, access: "allowlist", allowedNumbers: [] });
    expect(config.channels.web).toEqual({ enabled: true });
    expect(config.memory.longTerm).toEqual({ enabled: false, autoRecall: true, recallLimit: 5, maxPerOwner: 200, collection: "banglaclaw_memories" });
    expect(config.embeddings).toEqual({ provider: "openai-compatible", model: "text-embedding-3-small" });
    expect(config.agents).toEqual({ dirs: ["agents"], maxTransfers: 3 });
    expect(config.handoff).toEqual({ enabled: false });
    expect(config.knowledge).toMatchObject({ enabled: false, vectorStore: "memory", sources: [], chunkSize: 1200, chunkOverlap: 150 });
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

  it("parses MCP servers with defaults", () => {
    const cwd = tempDir(
      [
        "mcp:",
        "  servers:",
        "    bangladesh:",
        "      transport: stdio",
        "      command: node",
        "      args: [server.js]",
        "      env: { TOKEN: '${BD_TOKEN}' }",
        "    remote:",
        "      transport: http",
        "      url: https://mcp.example.com/mcp",
        "      timeoutMs: 5000",
      ].join("\n"),
    );
    const { config } = loadConfig({ cwd, env: {} });
    expect(config.mcp.servers.bangladesh).toEqual({
      transport: "stdio", command: "node", args: ["server.js"], env: { TOKEN: "${BD_TOKEN}" },
      enabled: true, timeoutMs: 30_000, connectTimeoutMs: 15_000,
    });
    expect(config.mcp.servers.remote).toMatchObject({ transport: "http", headers: {}, timeoutMs: 5000 });
  });

  it("rejects invalid MCP server names and transports", () => {
    expect(() => loadConfig({ cwd: tempDir("mcp:\n  servers:\n    Bad-Name:\n      transport: stdio\n      command: x\n"), env: {} })).toThrow(/Invalid key/);
    expect(() => loadConfig({ cwd: tempDir("mcp:\n  servers:\n    s:\n      transport: ws\n      url: ws://x\n"), env: {} })).toThrow(ConfigError);
  });

  it("overrides gateway host/port from env", () => {
    const { config } = loadConfig({ cwd: tempDir(), env: { BANGLACLAW_GATEWAY_PORT: "8080", BANGLACLAW_GATEWAY_HOST: "0.0.0.0" } });
    expect(config.gateway).toMatchObject({ host: "0.0.0.0", port: 8080 });
    expect(() => loadConfig({ cwd: tempDir(), env: { BANGLACLAW_GATEWAY_PORT: "http" } })).toThrow(ConfigError);
  });

  it("parses channel config and reads channel secrets from env only", () => {
    const cwd = tempDir("channels:\n  telegram:\n    enabled: true\n    allowedUserIds: [12345, '678']\n  whatsapp:\n    phoneNumberId: '1098'\n");
    const { config, secrets } = loadConfig({ cwd, env: { TELEGRAM_BOT_TOKEN: "123:abc", WHATSAPP_APP_SECRET: "s" } });
    expect(config.channels.telegram.allowedUserIds).toEqual(["12345", "678"]);
    expect(config.channels.whatsapp.phoneNumberId).toBe("1098");
    expect(secrets).toMatchObject({ telegramBotToken: "123:abc", whatsappAppSecret: "s" });
    expect(() => loadConfig({ cwd: tempDir("channels:\n  telegram:\n    botToken: x\n"), env: {} })).toThrow(ConfigError);
  });

  it("reads knowledge settings, QDRANT_URL and vector secrets", () => {
    const cwd = tempDir("knowledge:\n  enabled: true\n  vectorStore: qdrant\n  sources: [docs]\nembeddings:\n  model: bge-m3\n  baseUrl: http://localhost:11434/v1\n");
    const { config, secrets } = loadConfig({ cwd, env: { QDRANT_URL: "http://localhost:56333", QDRANT_API_KEY: "q", EMBEDDINGS_API_KEY: "e" } });
    expect(config.knowledge).toMatchObject({ enabled: true, vectorStore: "qdrant", vectorStoreUrl: "http://localhost:56333", sources: ["docs"] });
    expect(config.embeddings).toMatchObject({ model: "bge-m3", baseUrl: "http://localhost:11434/v1" });
    expect(secrets).toMatchObject({ qdrantApiKey: "q", embeddingsApiKey: "e" });
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
