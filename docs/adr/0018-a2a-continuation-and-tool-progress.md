# ADR-0018: A2A Task Continuation and Tool Progress

## Status

Accepted

## Context

The A2A client (ADR-0016) had two gaps. A remote agent that ends a task `input-required` (it asks "which branch?", or a human operator took over) came back as a tool error, so a clarifying exchange was impossible. And a slow remote agent showed nothing until its whole reply arrived, although A2A agents stream artifact chunks. No tool could report partial output: `ToolContext` had no channel for it and `RunEvent` had no event for it.

## Decision

- **`input-required` is a successful result.** The tool returns `{ reply: <the question>, state: "input-required" }`. The model decides whether to answer it or ask the user. The task id is kept with the session's remote conversation (the same bounded in-memory map as the `contextId`). The session's next call sends its message with that `taskId`, which continues the task. `newTask: true` skips this. A task the remote side can no longer continue is forgotten after one failed call, which tells the model to call again.
- **Streaming via `SendStreamingMessage`** when the card advertises it. The SDK falls back to a blocking send otherwise. Events are folded into one task snapshot: `append` chunks extend the artifact with the same id. When the stream ends early we poll `GetTask` as before. An abort sends `CancelTask`.
- **A generic progress channel, not an A2A special case.** `ToolContext.progress?(text)` reports the whole output so far. Snapshots rather than deltas, because A2A artifacts can be replaced as well as appended. The agent graph turns each call into `RunEvent { type: "tool_progress", toolCallId, tool, text }`. Progress is display-only: the model and the stored history still see only the final tool output, so text that a remote agent later revises never reaches the prompt. Listener exceptions are swallowed so that display bugs never fail a tool.
- **Additive on `/v1`.** SSE and WebSocket already forward every run event, so `tool_progress` appears there and in the typed client. Clients must ignore events they do not know (docs/18). The widget whitelists its events, so anonymous visitors never see tool output.

## Consequences

Positive:
- Remote agents can hold a clarifying conversation, including waiting on a remote human operator
- Users see long remote replies as they arrive; other tools (MCP progress, long downloads) can use the same channel later

Trade-offs:
- Pending tasks are in memory: after a restart the next call starts a new task
- Progress events add stream traffic in proportion to the number of remote chunks; consumers that do not need them must ignore them
