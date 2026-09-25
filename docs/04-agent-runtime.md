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
- `AgentRuntime` (`runtime.ts`) wraps the graph. For each run it:
  - loads the session's short-term memory window from the `SessionStore` (docs/07);
  - selects skills (docs/08) and injects their instructions into the system prompt;
  - enforces the run timeout via `AbortSignal`;
  - saves a `RunRecord` to the `RunStore` for every run, including failures;
  - appends the run's new messages to the session.
- With a checkpointer (`PostgresSaver` when `storage.provider: postgres`), graph state is checkpointed per run under `thread_id = runId`, which `runtime.checkpoint(runId)` reads back. Conversation history is owned by the session store, not by checkpoints.

MCP tools (v0.3) are registered in the same `ToolRegistry` and run through the same `tools` node, so the dedicated `mcp` branch in the target graph below is not needed.

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
