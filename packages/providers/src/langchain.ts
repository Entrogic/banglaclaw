import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { ProviderError } from "@entrogic-net/shared";
import type { ModelCallOptions, ModelProvider } from "./provider.js";

/** Adapts any LangChain chat model with tool-calling support to {@link ModelProvider}. */
export class LangChainProvider implements ModelProvider {
  readonly id: string;
  readonly #model: BaseChatModel;

  constructor(id: string, model: BaseChatModel) {
    this.id = id;
    this.#model = model;
  }

  #runnable(options: ModelCallOptions) {
    if (options.tools === undefined || options.tools.length === 0) return this.#model;
    if (this.#model.bindTools === undefined) {
      throw new ProviderError(`Model ${this.id} does not support tool calling`);
    }
    return this.#model.bindTools(options.tools);
  }

  async chat(messages: BaseMessage[], options: ModelCallOptions = {}): Promise<AIMessage> {
    try {
      return (await this.#runnable(options).invoke(messages, { signal: options.signal })) as AIMessage;
    } catch (error) {
      throw wrap(this.id, error);
    }
  }

  async *stream(messages: BaseMessage[], options: ModelCallOptions = {}): AsyncIterable<AIMessageChunk> {
    try {
      const stream = await this.#runnable(options).stream(messages, { signal: options.signal });
      for await (const chunk of stream) yield chunk as AIMessageChunk;
    } catch (error) {
      throw wrap(this.id, error);
    }
  }
}

function wrap(id: string, error: unknown): Error {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(`${id}: ${message}`, { cause: error });
}
