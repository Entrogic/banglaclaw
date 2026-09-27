# ADR-0015: Agent2Agent (A2A) Protocol

## Status

Accepted

## Context

BanglaClaw is reachable over its own `/v1` API, chat channels and MCP (`banglaclaw mcp serve`). Agent frameworks increasingly delegate work to other agents over [A2A](https://a2a-protocol.org/), which is now a Linux Foundation project with a stable v1.0 specification. A Bangla-first agent is a natural specialist for such systems: others can send it Bangla and Banglish work. Many deployed agents still speak A2A v0.3.

## Decision

- **Use the official `@a2a-js/sdk`** (v1.x) instead of implementing the protocol. Its `DefaultRequestHandler` owns the task lifecycle, and its JSON-RPC transport handlers (v1.0 and the v0.3 compatibility handler) do not depend on a web framework. We mount them on the Hono gateway instead of using the SDK's Express adapters, so Express is never loaded.
- **The server lives in the gateway** (`packages/gateway/src/a2a/`), behind `a2a.server.enabled`, which is off by default. The gateway already owns API-key auth, rate limits, scopes, session ownership and per-key concurrency, and A2A reuses all of them: `/a2a` runs the same middleware as `/v1`. The agent card is public, as the protocol expects.
- **JSON-RPC only**, protocol v1.0 plus v0.3. REST and gRPC add surface without a current user.
- **One session per `(user, contextId)`** on a new `a2a` channel. Conversation history stays in `SessionStore`, like every channel. A2A task objects are protocol state only and live in the SDK's user-scoped `InMemoryTaskStore`, so a restart loses task ids but not conversations.
- **The reply is one artifact.** Streaming sends lifecycle events, not token chunks, because the runtime may discard text written before a tool call.
- **Handoff maps to `input-required`.** Operator replies are not pushed to A2A callers.

## Consequences

Positive:
- Any A2A client can use BanglaClaw's skills, tools, knowledge and permission policy with an ordinary API key
- No new auth model, and no bypass of the rate or concurrency limits
- Runs are recorded, audited and visible in the dashboard like any other channel

Trade-offs:
- Tasks are in memory: a multi-instance gateway needs sticky routing for `GetTask`/`CancelTask`, and task ids do not survive restarts
- No push notifications, files, or REST/gRPC bindings yet
- The SDK is a new runtime dependency of the gateway (it brings `jose`)
