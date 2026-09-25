# 04 — Agent Runtime

## Role

The Agent Runtime is the execution engine of BanglaClaw. LangGraph is used for stateful graph orchestration.

## Implemented graph (v0.1)

Implemented in `packages/agent/src/graph.ts`:

```text
START → prepare → model ─┬─ tool calls, within limits ─→ tools → model
                         ├─ tool calls, limit reached ──→ limit → END
                         └─ no tool calls ──────────────→ finalize → END
```

- `prepare` detects the input language deterministically (`detectLanguage`, no model call).
- `model` streams from the `ModelProvider` with only the policy-allowed tools bound, emitting `token` events.
- `tools` runs each call through `executeTool` (validation → permission → execution → audit).
- `limit` enforces `maxIterations` / `maxToolCalls`, closes dangling tool calls and replies with a localised message.
- `AgentRuntime` (`runtime.ts`) wraps the graph: run timeout via `AbortSignal`, per-session history (in memory until v0.2), and a `RunRecord` saved to a `RunStore` for every run, including failures.

## Target graph

The router / planner / verifier / MCP branches below are planned for later releases:

```text
START
  ↓
prepare
  ↓
router
  ├──→ answer
  ├──→ planner → tools → verifier
  └──→ mcp → verifier
                ↓
             response
                ↓
               END
```

## State

v0.1 implements `sessionId`, `messages`, `input`, `language`, `response` plus the loop counters `iterations`, `toolCallCount` and `stopReason` (`packages/agent/src/state.ts`). Target shape:

```ts
interface AgentState {
  sessionId: string;
  messages: BaseMessage[];
  input: string;
  language: "bn" | "bn-en" | "en";
  intent?: string;
  plan?: string[];
  toolCalls?: ToolCall[];
  observations?: unknown[];
  response?: string;
}
```

## Runtime responsibilities

- Build execution context
- Invoke graph
- Stream events
- Execute tools through permission checks
- Handle errors
- Persist run state
- Support checkpointing
- Emit telemetry

## Runtime must not

- Know Telegram/WhatsApp-specific APIs
- Contain provider-specific business logic
- Grant unrestricted tool permissions
