# 06 — Session

## Session model

Implemented in `packages/session`:

```ts
interface Session {
  id: string;
  channel: string;
  externalId?: string;   // channel-native conversation id (Telegram chat id, …)
  userId?: string;
  agentId: string;
  title?: string;                  // first user message, at most 80 characters (1.4)
  status: "active" | "handoff";   // handoff: a human operator owns the conversation (v0.7)
  activeAgent?: string;            // specialist answering the next message (v0.7)
  handoffReason?: string;
  handoffAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

`SessionStore.update(id, { status, activeAgent, handoffReason })` changes routing and handoff state. `title` is set by the store in `appendMessages` from the first user message (`titleFromMessages`: whitespace collapsed, capped at 80 characters) and never overwritten. `list({ query })` also matches it. Sessions stored before 1.4 got titles from migration `0005_session_titles`. `HandoffDesk` (`packages/session/src/handoff.ts`) implements the operator queue: `queue`, `get`, `reply` and `release`.

## Stores

- `SessionStore` — create/get/list sessions, `findByExternalId(channel, externalId)`, `appendMessages(sessionId, runId, messages)`, `recentMessages(sessionId, limit)`.
- `RunStore` — `save(RunRecord)`, `get(id)`, `listBySession(sessionId)`; a run record carries status, language, skills, output/error and its tool-call audit events.
- In-memory implementations (default) and PostgreSQL implementations in `packages/storage`.

`SessionManager.resolve()` picks the session for an incoming message: an explicit session id (must exist), an existing `(channel, externalId)` conversation, or a new session. `AgentRuntime.run()` requires an existing session id.

## Persistence rules

- Every run is saved to the `RunStore`, including failed, aborted and limited runs.
- Messages are appended only after a run finishes (completed or limited), so stored history never contains unanswered tool calls.
- Tables: `sessions`, `messages`, `runs`, `tool_calls` (a `users` table arrives with authentication in v0.4).

## Session responsibilities

- Identify conversation
- Restore state/checkpoint
- Attach user context
- Persist messages
- Track active agent
