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

## Multi-agent teams (v0.7)

Specialists are defined in `agents/<name>/AGENT.md` (`packages/agents`):

```markdown
---
name: sales                       # kebab-case; "supervisor" and "human" are reserved
description: Prices, discounts and orders      # shown to the supervisor for routing
tools: [search_knowledge, calculator]          # narrows tools.allow (never widens it)
skills: [calculation]                          # optional; default: all skills
---
Instructions for the specialist…
```

- **Supervisor.** The default agent. It gets a `transfer_to_<agent>` control tool per specialist and keeps only the tools no specialist claims, so domain requests get routed.
- **Specialists.** Each uses only its own tool subset (enforced by a scoped permission policy, not just the prompt), and can call `transfer_to_supervisor`.
- **Routing state.** Transfers happen inside a run (the specialist answers in the same run). The session remembers `activeAgent`, so follow-ups go straight to the specialist. `agents.maxTransfers` (default 3) stops agents bouncing a request back and forth.
- **Events and records.** `agent_transfer` events are emitted, and `RunRecord.agent` / `agentPath` record the route.
- **Single-agent mode.** With no AGENT.md files and handoff disabled, behavior is exactly the single-agent graph.

## Human handoff (v0.7)

With `handoff.enabled`, every agent can call `request_human` with a reason:

1. The run ends with a localised "a human will reply" message.
2. The session is set to `status: handoff` (with the reason and time), and `HANDOFF_WEBHOOK_URL` is notified if set.
3. While handed off, user messages are stored for the operator. The bot doesn't call the model or reply (`RunRecord.status = handoff`, `agent = human`), and channels stay silent.
4. Operators (users with `role: operator`) work the queue through `/v1/handoffs` or `banglaclaw handoff list | show | reply | release`.
5. Replies are stored as assistant messages tagged `response_metadata.operator`, audited as runs, and delivered through the session's channel (Telegram, WhatsApp). API and web-chat clients that follow the session (WebSocket `subscribe` or `GET /v1/sessions/:id/events`, docs/18) receive them live; others read them from the messages endpoint.
6. `release` returns the session to the supervisor.

Smaller models sometimes claim to "transfer" or "escalate" in text without calling the tool. The prompts forbid this, but only the tool calls actually change state.

MCP tools (v0.3) are registered in the same `ToolRegistry` and run through the same `tools` node, so the dedicated `mcp` branch in the target graph below is not needed.

## Target graph

The planner / verifier branches below are still planned (routing is covered by the team supervisor):

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
