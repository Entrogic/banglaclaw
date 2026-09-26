import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ConfigError, type BanglaClawConfig, type Secrets } from "@entrogic-net/shared";
import { LangChainProvider } from "./langchain.js";
import type { ModelProvider } from "./provider.js";

type ModelConfig = BanglaClawConfig["models"]["default"];

/** Returns the env var that must hold the API key for this model config, or undefined if none is required. */
export function requiredApiKeyEnv(model: ModelConfig): "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | undefined {
  if (model.provider === "anthropic") return "ANTHROPIC_API_KEY";
  // Self-hosted OpenAI-compatible servers (Ollama, vLLM) usually need no key.
  return model.baseUrl === undefined ? "OPENAI_API_KEY" : undefined;
}

export function createProvider(model: ModelConfig, secrets: Secrets): ModelProvider {
  const id = `${model.provider}:${model.model}`;

  switch (model.provider) {
    case "openai-compatible": {
      const apiKey = secrets.openaiApiKey ?? (model.baseUrl !== undefined ? "not-needed" : undefined);
      if (apiKey === undefined) {
        throw new ConfigError("OPENAI_API_KEY is not set (or set models.default.baseUrl for a keyless local server)");
      }
      return new LangChainProvider(
        id,
        new ChatOpenAI({
          model: model.model,
          apiKey,
          ...(model.temperature !== undefined && { temperature: model.temperature }),
          ...(model.baseUrl !== undefined && { configuration: { baseURL: model.baseUrl } }),
        }),
      );
    }
    case "anthropic": {
      if (secrets.anthropicApiKey === undefined) {
        throw new ConfigError("ANTHROPIC_API_KEY is not set");
      }
      return new LangChainProvider(
        id,
        new ChatAnthropic({
          model: model.model,
          apiKey: secrets.anthropicApiKey,
          ...(model.temperature !== undefined && { temperature: model.temperature }),
          ...(model.baseUrl !== undefined && { anthropicApiUrl: model.baseUrl }),
        }),
      );
    }
  }
}
