import type { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { ToolSpec } from "@banglaclaw/shared";

export interface ModelCallOptions {
  tools?: ToolSpec[];
  signal?: AbortSignal;
}

/**
 * The only surface the agent runtime uses to talk to an LLM. Adapters must not leak
 * provider-specific behaviour past this interface.
 */
export interface ModelProvider {
  /** e.g. "openai-compatible:gpt-4o-mini" — for logs and run records. */
  readonly id: string;
  chat(messages: BaseMessage[], options?: ModelCallOptions): Promise<AIMessage>;
  stream(messages: BaseMessage[], options?: ModelCallOptions): AsyncIterable<AIMessageChunk>;
}
