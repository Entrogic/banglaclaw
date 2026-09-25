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
Abstracts LLM APIs.

### Storage
Persists sessions, messages, runs, memories and audit information.

## Key principle

**Gateway, channel, agent runtime and tools must remain independently replaceable.**
