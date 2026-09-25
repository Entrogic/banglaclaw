# Changelog

All notable changes to BanglaClaw. The project follows [Semantic Versioning](https://semver.org); the `/v1` HTTP API is stable from 1.0.0 (docs/18).

## Unreleased

- **Admin API** (admin role, docs/18):
  - `GET /v1/admin/stats`: run analytics with daily buckets in `timezone`, per-channel, provider and agent breakdowns, top tools, and cost estimates from the new `pricing` config
  - `GET /v1/admin/sessions[/:id]`: sessions of all users, searchable
  - `/v1/admin/keys`: list, issue and revoke API keys (audited)
- `RunStore.stats()` (SQL aggregation in Postgres). `SessionStore.list()` now takes `query`, and `InMemoryRunStore` takes the session store for channel breakdowns.
- **Admin dashboard** (`apps/dashboard`, served at `/admin` when `gateway.dashboardDir` is set; included in the Docker image):
  - overview with runs and tokens per day, runs by channel, model and agent, top tools and estimated cost
  - sessions browser (search, status and channel filters) with transcripts and runs
  - handoff queue: read the conversation, reply as operator, release to the bot; a waiting count in the nav
  - agent: model, tools with risk and allowlist result, skills with triggers
  - knowledge: ingested documents and a search tester
  - audit log with an action filter
  - API keys: issue (token shown once), list and revoke
  - `pnpm --filter @banglaclaw/dashboard demo` for UI work with seeded data
- `@banglaclaw/client` covers the admin endpoints.
- **Voice notes:** Telegram, WhatsApp and Messenger voice messages are transcribed (OpenAI-compatible `/audio/transcriptions`, `voice.*` config, Bangla hint by default) and answered like text; downloads happen only after the access and rate checks, long notes are refused before download, and failures get localised notices (docs/11).
- **DOCX and URL knowledge sources:** `.docx` files (read with Node's zlib, no new dependency, zip-bomb guarded) and `http(s)://` URLs (HTML, text, markdown, PDF, DOCX by content type; 20 s, 10 MB) in `knowledge.sources` and `kb ingest` (docs/07).
- **Facebook Messenger channel** (`channels.messenger`): signed webhook with the Get Started button as /start, replies split at 2,000 characters with a typing indicator, page filter, allowlist or open access, operator replies (optionally with the HUMAN_AGENT tag), and a `doctor` check of the page behind the token. Meta signature and handshake code is shared with WhatsApp (docs/11).
- **BanglaClaw as an MCP server:** `banglaclaw mcp serve` (stdio) offers `ask` (the agent, with per-conversation history, skills, tools and permission policy) and read-only `search_knowledge`, for Claude Desktop, Cursor, Claude Code and other MCP clients (docs/10).
- **Live operator replies for API clients:** follow a session with WebSocket `subscribe` or `GET /v1/sessions/:id/events` (SSE) to receive `operator_message` and `handoff_released` events; the web chat follows its session automatically, and `delivered` is true when a follower got the reply. SDK: `sessions.events(id, { signal })`; `parseSSE` takes an optional `signal`.
- With memory storage, the temporary key printed by `serve` is now an admin key, so the dashboard works without Postgres.

## 1.1.0 — Professional CLI

- **`banglaclaw chat` is a full-screen Ink UI** with:
  - markdown replies, tool-call lines, agent-transfer and handoff banners
  - a status bar with a spinner, elapsed time, tokens, agent path and session
  - a slash-command menu (Tab completion), persistent input history, multiline input
  - Esc/Ctrl+C cancellation

  Line mode (`--plain`, pipes) now buffers piped input correctly.
- **`banglaclaw init` wizard:** provider and model, hidden API key entry with a live connection test, storage with PostgreSQL migration, optional extras (knowledge, memory, Telegram, example agents, handoff). It writes `banglaclaw.yaml` and a 0600 `.env` without clobbering existing keys, then runs doctor. `--yes` writes the template.
- **Consistent output:**
  - `--json` on list/show/status commands, `doctor`, `version` and `agent run`
  - `-q/--quiet` and `--no-color` / `NO_COLOR` / `FORCE_COLOR`
  - aligned, width-aware tables (Bangla-safe)
  - errors with actionable hints and stable exit codes (0/1/2/3/4/130)
  - quiet exit on EPIPE (`| head`)
- **Structure:** `apps/cli/src/commands/*`, `ui/*`, `tui/*`, `program.ts`.
- **Help and polish:** grouped `--help` (Chat / Data / Server / Setup) with examples, `banglaclaw completion bash|zsh|fish`, `banglaclaw version`, spinners for slow commands, and a redesigned `doctor` (sectioned, JSON report) and `serve` banner.

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
