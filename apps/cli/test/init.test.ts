import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ConfigSchema } from "@banglaclaw/shared";
import { buildConfigYaml, envKeys, mergeEnv } from "../src/init/config.js";

describe("buildConfigYaml", () => {
  it("produces a valid config without secrets", () => {
    const yaml = buildConfigYaml({
      provider: "local", model: "qwen2.5", baseUrl: "http://localhost:11434/v1", storage: "postgres",
      knowledge: { sources: ["docs"], vectorStore: "qdrant", qdrantUrl: "http://localhost:56333" },
      longTermMemory: true, telegram: { allowedUserIds: ["12345"] }, agents: true, handoff: true,
    });
    expect(yaml).toMatch(/^# BanglaClaw configuration/);
    const config = ConfigSchema.parse(parse(yaml));
    expect(config.models.default).toMatchObject({ provider: "openai-compatible", model: "qwen2.5", baseUrl: "http://localhost:11434/v1" });
    expect(config.storage.provider).toBe("postgres");
    expect(config.knowledge).toMatchObject({ enabled: true, vectorStore: "qdrant", sources: ["docs"] });
    expect(config.embeddings.baseUrl).toBe("http://localhost:11434/v1");
    expect(config.channels.telegram).toMatchObject({ enabled: true, allowedUserIds: ["12345"] });
    expect(config.handoff.enabled).toBe(true);
    expect(yaml).not.toMatch(/sk-|api_?key:/i);
  });

  it("keeps a minimal config minimal", () => {
    const config = ConfigSchema.parse(parse(buildConfigYaml({ provider: "anthropic", model: "claude-sonnet-5", storage: "memory" })));
    expect(config.models.default).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
    expect(config.knowledge.enabled).toBe(false);
  });
});

describe("mergeEnv", () => {
  it("adds new keys, fills empty ones and never clobbers existing values", () => {
    const existing = "# my env\nOPENAI_API_KEY=sk-old\nDATABASE_URL=\nOTHER=1\n";
    const r = mergeEnv(existing, { OPENAI_API_KEY: "sk-new", DATABASE_URL: "postgres://x", TELEGRAM_BOT_TOKEN: "1:a b" });
    expect(r.kept).toEqual(["OPENAI_API_KEY"]);
    expect(r.replaced).toEqual(["DATABASE_URL"]);
    expect(r.added).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(r.text).toBe('# my env\nOPENAI_API_KEY=sk-old\nDATABASE_URL=postgres://x\nOTHER=1\nTELEGRAM_BOT_TOKEN="1:a b"\n');
    expect(mergeEnv(existing, { OPENAI_API_KEY: "sk-new" }, new Set(["OPENAI_API_KEY"])).text).toContain("OPENAI_API_KEY=sk-new");
    expect([...envKeys(existing)]).toEqual(["OPENAI_API_KEY", "OTHER"]);
    expect(mergeEnv("", { A: "1" }).text).toBe("A=1\n");
  });
});
