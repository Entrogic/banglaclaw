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
| Session events | Operator replies and handoff releases pushed to clients following a session (WebSocket `subscribe` or SSE `/v1/sessions/:id/events`), via an in-process `SessionEvents` bus |
| Rate limiting | Per-key token bucket plus a per-key concurrent-run cap (in process) |
| Request IDs | `X-Request-Id` accepted or generated, echoed, logged and included in errors |
| Error mapping | A consistent error body; provider failures → 502, timeouts → 504; internals never leak |

Client disconnects (SSE) and socket closes (WS) abort in-flight runs. See docs/18 for the API.

Since v0.5 the gateway also mounts channel webhook routes (`deps.routes`), which verify their own signatures instead of using API keys, and serves the web chat page at `/chat` (`deps.webChat`) and, with `deps.widget`, the website widget (`/widget.js`, `/widget/frame`, `/widget/api/*`: visitor tokens instead of API keys, per-visitor and per-IP limits, frame-ancestors from `channels.widget.allowedOrigins`). See docs/11. With `gateway.dashboardDir` set it also serves the built admin dashboard (`apps/dashboard`) at `/admin` with a strict CSP; the page itself is public static files and every call it makes goes to `/v1/admin` with an admin key.

## Flow

```text
Telegram ─┐
WhatsApp ─┤
Messenger ┤
Web ──────┼──→ Gateway → Session → Agent Runtime
CLI ──────┤
REST ─────┘
```

## Rule

A channel must not contain agent reasoning logic.

## Planned

- Shared rate-limit store and session-event bus (Redis) for horizontal scaling
- Per-key tool allowlists (key scopes `read`/`run` shipped in v1.0)
- A dedicated `apps/gateway` entry point; today the CLI hosts it (`banglaclaw serve`)
