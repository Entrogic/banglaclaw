import type { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ProviderError } from "@entrogic-net/shared";
import type { ModelProvider } from "./provider.js";

/**
 * Stands in when no model provider can be built (no API key, no active profile), so BanglaClaw
 * still starts and an admin can add one in the dashboard (docs/12). Every model call fails with
 * a message that says how to configure a provider; nothing is sent anywhere.
 */
export class UnconfiguredProvider implements ModelProvider {
  readonly id = "unconfigured";
  readonly message: string;

  constructor(reason: string) {
    // "OPENAI_API_KEY is not set (or set models.default.baseUrl …)": the advice follows below.
    const short = reason.replace(/\s*\(.*\)\s*$/, "");
    this.message = `No model provider is configured (${short}). Add one on the dashboard's Providers page (/admin/providers), set OPENAI_API_KEY or ANTHROPIC_API_KEY, or point models.default.baseUrl at a local server such as Ollama.`;
  }

  chat(): Promise<AIMessage> {
    return Promise.reject(new ProviderError(this.message));
  }

  async *stream(): AsyncIterable<AIMessageChunk> {
    throw new ProviderError(this.message);
  }
}
