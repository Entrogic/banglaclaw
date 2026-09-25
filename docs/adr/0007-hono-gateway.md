# ADR-0007: Hono for the HTTP Gateway

## Status

Accepted

## Context

v0.4 adds an HTTP gateway with REST endpoints, Server-Sent Events and WebSockets (docs/05, docs/18). The gateway must stay a thin transport layer in front of `AgentRuntime` (ADR-0005).

## Decision

Build the gateway with Hono:

- `hono` for routing, middleware (CORS, body limit), and the `streamSSE` helper
- `@hono/node-server` and `@hono/node-ws` to run on Node with WebSocket support
- Our own middleware for API-key authentication, request IDs, rate limiting and error mapping

## Consequences

Positive:
- Built on Web-standard `Request`/`Response`, so routes are testable with `app.request()` without opening ports
- Small dependency footprint; portable to other runtimes later
- First-class SSE streaming

Trade-offs:
- Fewer batteries than Fastify (no built-in OpenAPI or rate-limit plugins), so these are implemented in-repo
- The `@hono/node-ws` peer range pins `@hono/node-server` to 1.x for now
