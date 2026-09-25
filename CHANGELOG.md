# Changelog

All notable changes to BanglaClaw. The project follows [Semantic Versioning](https://semver.org); the `/v1` HTTP API is stable from 1.0.0 (docs/18).

## 1.0.0 — Production runtime

- **Security:**
  - an audit log (`audit_logs`, `banglaclaw audit`, `GET /v1/audit`) and an `admin` role
  - API-key scopes (`read`, `run`)
  - security response headers and `gateway.trustProxy`
  - CI with a dependency audit
- **Observability:** OpenTelemetry tracing (runs, model calls, tool calls, HTTP), Prometheus `/metrics`, and token usage per run.
- **Stable API:** an OpenAPI 3.1 spec at `/v1/openapi.json` with a route-coverage contract test, a versioning and deprecation policy, and the typed `@banglaclaw/client` SDK.
- **Plugins:** `@banglaclaw/plugin-sdk` and `plugins:` in the config (tools, skills, agents, context providers), with the example `bd-phone` plugin.
- **Deployment:** a production Dockerfile (non-root, healthcheck), `docker/compose.prod.yaml`, and deployment, operations and plugin guides.
- Licensed under Apache-2.0.

## 0.7.0 — Multi-agent

- A supervisor routing to AGENT.md specialists with scoped tool subsets, transfer limits, and a per-session active agent.
- Human handoff: `request_human`, an operator queue (`banglaclaw handoff`, `/v1/handoffs`), replies delivered through the user's channel, and webhook notifications.

## 0.6.0 — Knowledge

- A RAG knowledge base (txt/md/html/pdf, Bangla-aware chunking, OpenAI-compatible embeddings, in-memory or Qdrant vectors) with the `search_knowledge` tool.
- Owner-scoped long-term memory (`remember` / `recall` / `forget`, auto-recall).

## 0.5.0 — Channels

- Telegram (polling or webhook), the WhatsApp Cloud API, and a browser chat page; allowlist access and per-chat rate limits.

## 0.4.0 — Gateway

- A Hono HTTP gateway: REST, SSE and WebSocket; API keys with per-user isolation; rate limits.

## 0.3.0 — MCP

- An MCP client (stdio and Streamable HTTP) feeding the permission-checked tool registry; the bundled Bangladesh MCP server.

## 0.2.0 — State and skills

- Sessions, PostgreSQL persistence (Drizzle), a short-term memory window, LangGraph checkpoints, and SKILL.md skills.

## 0.1.0 — Agent core

- A TypeScript monorepo; the LangGraph runtime; OpenAI-compatible and Anthropic providers; tool calling with an allowlist; streaming; Bangla/Banglish/English detection; the CLI.
