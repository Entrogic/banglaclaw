# ADR-0013: Website Widget with Signed Visitor Tokens

## Status

Accepted

## Context

Shops, clinics and other Bangladeshi businesses want the agent on their own website. The web chat (`/chat`) needs an API key, which must never be put in a public page. Visitors are anonymous, and so are the host sites' users. Whatever is embedded must not let arbitrary sites use the bot, must not leak tool internals, and must survive a busy homepage.

## Decision

- **Gateway-served widget.** The gateway serves `/widget.js` (a loader with the public settings baked in), `/widget/frame` (the chat page, in an iframe) and `/widget/api/*`. The frame is same-origin with the API, so there is no CORS surface, and it reuses the web chat's escaping markdown renderer. It lives in the gateway rather than `packages/channels` because it needs the gateway's session-event bus for operator replies and its SSE streaming.
- **Embedding control with CSP.** `/widget/frame` sends `frame-ancestors <channels.widget.allowedOrigins>` instead of `X-Frame-Options: DENY`. The browser enforces the allowlist, and an empty list refuses to start.
- **Signed visitor tokens.** `POST /widget/api/session` returns `v1.<uuid>.<exp>.<HMAC-SHA256>` signed with `BANGLACLAW_WIDGET_SECRET`. The server stores nothing per token. The uuid is the `externalId` of one `widget` session with no `userId`, so widget conversations appear in the dashboard, analytics and the handoff queue like any channel. A valid token can be renewed, which keeps the conversation, and a reset detaches the session.
- **Visitor-safe stream.** The frame receives `token`, `activity` (without the tool name), `handoff` and `done`/`error` only. History returns text messages only.
- **Layered limits.** Per-visitor and per-IP message budgets, new visitors per IP, one reply per visitor at a time, and a global cap on concurrent widget replies, all using the existing in-process limiters.

## Consequences

Positive:
- One script tag adds the agent to any allowed site, with no keys in the page and no CORS configuration
- Operators handle widget conversations with the existing handoff tools, and the visitor sees replies live
- Visitor state lives entirely in the token, so there is nothing to clean up and no table to migrate

Trade-offs:
- The frame's localStorage is partitioned per host site, and browsers that block third-party storage lose the conversation on reload
- Anyone who can open an allowed site can use the tools in `tools.allow`, so operators must keep that list public-safe
- Limits are per gateway process, like the rest of the gateway (a shared store is on the roadmap), and per-IP limits need `gateway.trustProxy` behind a proxy
- Without a configured secret, tokens are invalidated on every restart
