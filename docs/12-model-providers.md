# 12 — Model Providers

BanglaClaw must remain model-provider independent.

## Providers

Potential adapters:

- OpenAI
- Anthropic
- Google
- DeepSeek
- Ollama
- vLLM
- OpenAI-compatible APIs

## Interface

```ts
interface ModelCallOptions {
  tools?: ToolSpec[];      // OpenAI function format, accepted by all adapters
  signal?: AbortSignal;
}

interface ModelProvider {
  readonly id: string;     // e.g. "anthropic:claude-sonnet-5"
  chat(messages: BaseMessage[], options?: ModelCallOptions): Promise<AIMessage>;
  stream(messages: BaseMessage[], options?: ModelCallOptions): AsyncIterable<AIMessageChunk>;
}
```

Streaming yields message chunks (not plain strings) so tool calls can be streamed alongside text.

## Implemented adapters (v0.1)

`packages/providers` wraps LangChain chat models via `LangChainProvider`; `createProvider(config, secrets)` picks one:

| `provider` | Backed by | Key env var | Notes |
|---|---|---|---|
| `openai-compatible` | `@langchain/openai` `ChatOpenAI` | `OPENAI_API_KEY` | Set `baseUrl` for DeepSeek, OpenRouter, vLLM, Ollama (`http://localhost:11434/v1`); no key needed when `baseUrl` is set |
| `anthropic` | `@langchain/anthropic` `ChatAnthropic` | `ANTHROPIC_API_KEY` | |

`FakeProvider` replays scripted turns for deterministic tests.

## Example

```text
Agent Runtime
     ↓
ModelProvider interface
     ├── OpenAI
     ├── Ollama
     ├── vLLM
     └── DeepSeek
```
