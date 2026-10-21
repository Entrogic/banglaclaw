# 03 — Architecture

## High-level architecture

```text
                         ┌──────────────┐
                         │   Channels   │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │   Gateway    │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │   Session    │
                         │   Manager    │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │ Agent Runtime│
                         │  LangGraph   │
                         └──────┬───────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
          ┌───▼───┐         ┌───▼───┐         ┌───▼───┐
          │Skills │         │ Tools │         │  MCP  │
          └───────┘         └───────┘         └───────┘
              │                 │                 │
              └─────────────────┼─────────────────┘
                                │
                         ┌──────▼───────┐
                         │Model Provider│
                         └──────────────┘
```

## Architectural boundaries

### Channels
Translate platform-specific messages into the common message format.

### Gateway
Handles transport, authentication, session resolution, routing and streaming.

### Session Manager
Resolves user/session context and persists conversation state.

### Agent Runtime
Owns LangGraph execution and agent lifecycle.

### Skills
Reusable domain instructions and workflows.

### Tools
Typed executable capabilities.

### MCP
External tool/resource integration protocol.

### Model Provider
Abstracts LLM APIs: OpenAI-compatible endpoints (OpenAI, Gemini, OpenRouter, Groq, Ollama…) and Anthropic. `ProviderManager` picks the one each run uses: the config/env provider, or one an admin added and activated in the dashboard (docs/12, ADR-0019).

### Storage
Persists sessions, messages, runs, memories and audit information.

## Key principle

**Gateway, channel, agent runtime and tools must remain independently replaceable.**
