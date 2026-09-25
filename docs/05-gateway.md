# 05 — Gateway

## Purpose

The Gateway is the transport and orchestration boundary between channels and the agent runtime.

## Implemented (v0.4)

`packages/gateway` is a Hono app (ADR-0007) that runs on Node through `@hono/node-server` and `@hono/node-ws`. It is started with `banglaclaw serve`.

| Responsibility | Implementation |
|---|---|
| Authentication | API keys (`packages/auth`): `bck_<id>_<secret>`, SHA-256 hashed, revocable, `last_used_at` tracked |
| Authorization | Sessions, messages and runs are scoped to the key's user; other users' resources return 404 |
| Message normalization | HTTP/WS bodies are validated with Zod and passed to `AgentRuntime` as plain text |
| Session resolution | Explicit `sessionId`, the user's `externalId`, or a new `api` session |
| Agent dispatch | `AgentRuntime.run()`, shared across requests |
| Streaming | SSE on the run endpoints; WebSocket at `/v1/ws` with multiple runs and cancellation |
| Rate limiting | Per-key token bucket plus a per-key concurrent-run cap (in process) |
| Request IDs | `X-Request-Id` accepted or generated, echoed, logged and included in errors |
| Error mapping | A consistent error body; provider failures → 502, timeouts → 504; internals never leak |

Client disconnects (SSE) and socket closes (WS) abort in-flight runs. See docs/18 for the API.

## Flow

```text
Telegram ─┐
WhatsApp ─┤
Web ──────┼──→ Gateway → Session → Agent Runtime
CLI ──────┤
REST ─────┘
```

## Rule

A channel must not contain agent reasoning logic.

## Planned

- Channel adapters (Telegram, WhatsApp, web widget) on top of the gateway (v0.5)
- Shared rate-limit store (Redis) for horizontal scaling
- Key scopes (read-only, run-only) and per-key tool allowlists
- A dedicated `apps/gateway` entry point; today the CLI hosts it (`banglaclaw serve`)
