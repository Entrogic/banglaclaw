import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import type { ModelCallOptions, ModelProvider } from "./provider.js";

export interface ScriptedTurn {
  content?: string;
  usage?: { input: number; output: number };
  toolCalls?: { id?: string; name: string; args: Record<string, unknown> }[];
}

export interface RecordedCall {
  messages: BaseMessage[];
  toolNames: string[];
}

/**
 * Deterministic provider for tests: replays scripted turns in order (the last turn repeats
 * once the script runs out) and records what it was called with.
 */
export class FakeProvider implements ModelProvider {
  readonly id = "fake:scripted";
  readonly calls: RecordedCall[] = [];
  readonly #script: ScriptedTurn[];
  #index = 0;

  constructor(script: ScriptedTurn[]) {
    if (script.length === 0) throw new Error("FakeProvider needs at least one scripted turn");
    this.#script = script;
  }

  #next(messages: BaseMessage[], options: ModelCallOptions): { turn: ScriptedTurn; n: number } {
    options.signal?.throwIfAborted();
    this.calls.push({ messages: [...messages], toolNames: options.tools?.map((t) => t.function.name) ?? [] });
    const n = this.#index++;
    const turn = this.#script[Math.min(n, this.#script.length - 1)] as ScriptedTurn;
    return { turn, n };
  }

  #toolCalls(turn: ScriptedTurn, n: number) {
    return (turn.toolCalls ?? []).map((c, i) => ({ id: c.id ?? `call_${n}_${i}`, name: c.name, args: c.args, type: "tool_call" as const }));
  }

  async chat(messages: BaseMessage[], options: ModelCallOptions = {}): Promise<AIMessage> {
    const { turn, n } = this.#next(messages, options);
    return new AIMessage({ content: turn.content ?? "", tool_calls: this.#toolCalls(turn, n) });
  }

  async *stream(messages: BaseMessage[], options: ModelCallOptions = {}): AsyncIterable<AIMessageChunk> {
    const { turn, n } = this.#next(messages, options);
    for (const piece of (turn.content ?? "").match(/\S+\s*/g) ?? []) {
      yield new AIMessageChunk({ content: piece });
    }
    if (turn.usage !== undefined) {
      yield new AIMessageChunk({
        content: "",
        usage_metadata: { input_tokens: turn.usage.input, output_tokens: turn.usage.output, total_tokens: turn.usage.input + turn.usage.output },
      });
    }
    const toolCalls = this.#toolCalls(turn, n);
    if (toolCalls.length > 0) {
      yield new AIMessageChunk({
        content: "",
        tool_call_chunks: toolCalls.map((c, index) => ({
          id: c.id,
          name: c.name,
          args: JSON.stringify(c.args),
          index,
          type: "tool_call_chunk" as const,
        })),
      });
    }
  }
}
