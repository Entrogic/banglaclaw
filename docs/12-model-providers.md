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

`PROVIDER_PRESETS` (`@entrogic-net/shared`) lists popular services with their endpoint and default model, for `banglaclaw init` and the dashboard: OpenAI, Anthropic, Google Gemini (`https://generativelanguage.googleapis.com/v1beta/openai/`), OpenRouter (`https://openrouter.ai/api/v1`), Groq, DeepSeek, Mistral and Together AI. Everything except Anthropic runs on `openai-compatible` with that `baseUrl` and the key in `OPENAI_API_KEY`.

## Adding providers from the dashboard

Admins can add model providers at runtime on the dashboard's **Providers** page (or with `/v1/admin/providers`, docs/18) and choose which one new runs use, without editing `banglaclaw.yaml` or restarting ([ADR-0019](adr/0019-runtime-providers.md)).

- **A profile** has a name, a type (`openai-compatible` or `anthropic`), a model, and optionally a base URL, a temperature and an API key. The page has presets for OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, DeepSeek and a local Ollama, which fill in the base URL and a model.
- **API keys** are encrypted with AES-256-GCM under a key derived (HKDF-SHA256) from `BANGLACLAW_SECRET_KEY`, at least 32 characters (`openssl rand -base64 32`). Each ciphertext is bound to its profile id. The API never returns a key or its ciphertext, only a masked hint such as `sk-…a1b2`, and the audit log records only whether a key was given. Without `BANGLACLAW_SECRET_KEY` you can still add profiles, but they cannot hold a key. A profile without its own key uses `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from the environment if set, or no key for a local server.
- **Which provider runs use.** At most one profile is active; with none, the config/env provider (`models.default`) is used. Activating, editing the active profile, or deleting it (which goes back to the config provider) takes effect from the **next run**. The runtime picks its provider once at the start of each run, so a run never switches models midway. A profile is built when it is saved or activated, so one that could never run (for example Anthropic without a key) is refused with `400 invalid_provider`.
- **Test** sends "Reply with the single word OK." with the profile and shows the reply, or the error with any echoed key removed. It gives up after 20 seconds.
- **Startup.** `serve`, `chat`, `run` and the other commands use the active profile when they start. If it cannot be used (the stored key cannot be decrypted because `BANGLACLAW_SECRET_KEY` changed or is missing), BanglaClaw logs a warning and falls back to the config provider. With an active profile, the config provider's key is not required.
- **No key at all.** BanglaClaw starts even when no provider can be built (no `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, no `baseUrl`, no active profile), so a fresh install can run `banglaclaw serve` and add a provider in the dashboard. Startup prints a warning, `doctor` reports a warning instead of a failure, the Providers page shows a banner, and the agent's model is `unconfigured`. Until a provider is added, every run fails with a message explaining how to configure one, and nothing is sent to any model.
- **Storage.** Profiles are kept in the `model_providers` table with postgres storage. With memory storage they work, but they are lost on restart. Other gateway processes sharing the database pick up a switch when they restart.
- **Trust.** Admins choose where model calls go, base URL included. Only `http`/`https` URLs are accepted, but internal addresses are not blocked, so give the admin role only to people you trust with that.

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
