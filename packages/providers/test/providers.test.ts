import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { ConfigError } from "@banglaclaw/shared";
import { FakeProvider, createProvider, requiredApiKeyEnv } from "../src/index.js";

describe("createProvider", () => {
  it("builds an OpenAI-compatible provider", () => {
    const p = createProvider({ provider: "openai-compatible", model: "gpt-4o-mini" }, { openaiApiKey: "sk-test" });
    expect(p.id).toBe("openai-compatible:gpt-4o-mini");
  });

  it("allows keyless local OpenAI-compatible servers", () => {
    const model = { provider: "openai-compatible", model: "qwen2.5", baseUrl: "http://localhost:11434/v1" } as const;
    expect(requiredApiKeyEnv(model)).toBeUndefined();
    expect(() => createProvider(model, {})).not.toThrow();
  });

  it("builds an Anthropic provider", () => {
    const p = createProvider({ provider: "anthropic", model: "claude-sonnet-5" }, { anthropicApiKey: "sk-ant-test" });
    expect(p.id).toBe("anthropic:claude-sonnet-5");
  });

  it("throws ConfigError when the key is missing", () => {
    expect(() => createProvider({ provider: "anthropic", model: "claude-sonnet-5" }, {})).toThrow(ConfigError);
    expect(() => createProvider({ provider: "openai-compatible", model: "gpt-4o-mini" }, {})).toThrow(/OPENAI_API_KEY/);
  });
});

describe("FakeProvider", () => {
  it("streams content and tool calls that concatenate into a tool-calling message", async () => {
    const p = new FakeProvider([{ content: "Let me check.", toolCalls: [{ name: "calculator", args: { expression: "1+1" } }] }]);
    let merged: AIMessageChunk | undefined;
    for await (const chunk of p.stream([new HumanMessage("hi")])) merged = merged === undefined ? chunk : merged.concat(chunk);
    expect(merged?.content).toBe("Let me check.");
    expect(merged?.tool_calls).toEqual([
      expect.objectContaining({ id: "call_0_0", name: "calculator", args: { expression: "1+1" } }),
    ]);
  });
});
