<div align="center">

# 🐾 BanglaClaw

**A Bangla-first, open-source AI agent runtime, built with TypeScript, LangGraph and MCP.**

Stateful, tool-using, multi-channel agents that understand **বাংলা**, **Banglish** and **English**.

[![CI](https://github.com/Entrogic/banglaclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/Entrogic/banglaclaw/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-0b6b4f.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@entrogic-net/cli?color=0b6b4f&label=npm)](https://www.npmjs.com/package/@entrogic-net/cli)
![Node.js](https://img.shields.io/badge/node-%E2%89%A522-339933.svg?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)

[Quickstart](#quickstart) · [Features](#features) · [Architecture](#architecture) · [Usage](#usage) · [Documentation](#documentation) · [বাংলা ডকুমেন্টেশন](docs/bn/README.md)

</div>

---

## Why BanglaClaw?

Most agent frameworks treat Bangla as an afterthought. BanglaClaw starts from it:

- It **detects the language** of each message (Bengali script, romanised Banglish or English) and replies in the same language and script.
- Its **tools, knowledge base and channels** are built for Bangladeshi use cases: Bangla-aware document chunking, a bundled Bangladesh reference-data MCP server, and Telegram, WhatsApp and Messenger.
- It keeps **application code as the security boundary**. The model never decides on its own whether a tool call is allowed.

```text
$ banglaclaw agent run "২৫ * ৪ কত?"
⚙ calculator({"expression":"25*4"})
  → {"expression":"25*4","result":100} 2ms
২৫ × ৪ = ১০০
```

## Features

| Area | What you get |
|---|---|
| **Agent runtime** | A LangGraph agent loop with streaming, iteration, tool-call and timeout limits, per-run checkpoints, and a record of every run, including failed ones |
| **Models** | OpenAI-compatible APIs (OpenAI, Ollama, vLLM and others) and Anthropic, behind a provider interface |
| **Tools & MCP** | Zod-validated tools with risk levels, a deny-by-default allowlist and audit logging. An MCP client (stdio and Streamable HTTP), and BanglaClaw itself exposed as an MCP server |
| **Skills** | `SKILL.md` instruction packs selected by deterministic Bangla and Latin triggers |
| **Memory & knowledge** | Sessions in memory or PostgreSQL, RAG over txt, md, html, pdf, docx and URLs (Qdrant or in-memory vectors), and owner-scoped long-term memory |
| **Multi-agent** | A supervisor that routes to `AGENT.md` specialists with scoped tools, plus human handoff with an operator queue |
| **Channels** | Telegram, WhatsApp Cloud API and Facebook Messenger, including voice-note transcription, and a built-in web chat |
| **Gateway** | A stable `/v1` HTTP API with REST, SSE and WebSocket, API keys with scopes and roles, rate limits, an OpenAPI spec and a typed TypeScript client |
| **Interfaces** | A full-screen terminal chat, the web chat at `/chat`, and an admin dashboard at `/admin` (analytics, sessions, handoffs, keys, audit) |
| **Production** | An audit log, OpenTelemetry tracing, Prometheus metrics, token and cost tracking, plugins, and a non-root Docker image |

## Quickstart

### From npm

Requires **Node.js 22+**.

```bash
npx banglaclaw init         # guided setup: provider, key check, storage, features
npx banglaclaw chat         # full-screen chat

npm install -g @entrogic-net/cli   # or install the `banglaclaw` command globally
```

Libraries are published under the [`@entrogic-net`](https://www.npmjs.com/org/entrogic-net) scope, for example [`@entrogic-net/client`](https://www.npmjs.com/package/@entrogic-net/client) (typed API client) and [`@entrogic-net/plugin-sdk`](https://www.npmjs.com/package/@entrogic-net/plugin-sdk).

### From source

Requires **Node.js 22+** and **pnpm**.

```bash
git clone https://github.com/Entrogic/banglaclaw.git && cd banglaclaw
pnpm install
pnpm banglaclaw init        # guided setup: provider, key check, storage, features
pnpm banglaclaw chat        # full-screen chat
```

To configure by hand instead, copy `.env.example` to `.env`, set `OPENAI_API_KEY` (or `BANGLACLAW_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`), then run `pnpm banglaclaw doctor`. The CLI loads `./.env` automatically, and exported shell variables take precedence.

<details>
<summary><b>Run a local model with Ollama (no API key)</b></summary>

```bash
export BANGLACLAW_BASE_URL=http://localhost:11434/v1 BANGLACLAW_MODEL=qwen2.5
pnpm banglaclaw chat
```

</details>

### With Docker

```bash
cp .env.example .env        # set OPENAI_API_KEY and POSTGRES_PASSWORD
docker compose -f docker/compose.prod.yaml up -d --build
docker compose -f docker/compose.prod.yaml run --rm banglaclaw db migrate
docker compose -f docker/compose.prod.yaml run --rm banglaclaw key create --user my-app
```

This serves the web chat at `http://127.0.0.1:3000/chat` and the API spec at `/v1/openapi.json`. See [Deployment](docs/21-deployment.md) and [Operations](docs/22-operations.md).

## Architecture

```mermaid
flowchart LR
    C["Channels<br/>Telegram · WhatsApp · Messenger<br/>Web chat · CLI · MCP"] --> G["Gateway<br/>/v1 REST · SSE · WebSocket"]
    G --> S["Session Manager"]
    S --> A["Agent Runtime<br/>(LangGraph)"]
    A --> T["Skills · Tools · MCP"]
    A --> K["Knowledge & Memory"]
    A --> P["Model Providers<br/>OpenAI-compatible · Anthropic"]
```

The gateway, channels, agent runtime and tools stay independently replaceable ([ADR-0005](docs/adr/)). The runtime never touches channel APIs or provider specifics. The codebase is a pnpm + Turborepo monorepo:

| Path | Contents |
|---|---|
| `packages/` | The runtime libraries: `agent`, `agents`, `gateway`, `channels`, `providers`, `tools`, `mcp`, `skills`, `session`, `storage`, `knowledge`, `auth`, `observability`, `client`, `plugin-sdk`, `shared` |
| `apps/cli` | The `banglaclaw` command-line interface and terminal chat |
| `apps/dashboard` | The admin dashboard (Vite + React) |
| `mcp-servers/bangladesh` | A reference MCP server with Bangladeshi divisions and districts |
| `skills/`, `examples/` | Bundled skills, example specialist agents and an example plugin |

## Usage

<details open>
<summary><b>HTTP API</b> · <a href="docs/18-api.md">docs</a></summary>

```bash
pnpm banglaclaw serve     # memory storage prints a temporary admin key
                          # with Postgres: pnpm banglaclaw key create --user my-app

curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"text":"২৫ * ৪ কত?"}' http://127.0.0.1:3000/v1/agents/run

curl -N -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"text":"ekhon koyta baje?"}' "http://127.0.0.1:3000/v1/agents/run?stream=true"
```

</details>

<details>
<summary><b>Telegram bot</b> · <a href="docs/11-channels.md">docs</a></summary>

```bash
export TELEGRAM_BOT_TOKEN=123456:ABC...   # from @BotFather (or put it in .env)
# banglaclaw.yaml: channels.telegram.enabled: true, allowedUserIds: [<your numeric id>]
pnpm banglaclaw serve                     # long polling; also serves the web chat at /chat
```

WhatsApp Cloud API and Facebook Messenger use signed webhooks. Voice notes are transcribed and answered like text.

</details>

<details>
<summary><b>MCP tools, and BanglaClaw as an MCP server</b> · <a href="docs/10-mcp.md">docs</a></summary>

```bash
cp banglaclaw.example.yaml banglaclaw.yaml   # enables the bundled Bangladesh server
pnpm banglaclaw mcp list
pnpm banglaclaw agent run "কুমিল্লা কোন বিভাগে?"

# Use BanglaClaw from Claude Desktop, Cursor or Claude Code:
claude mcp add banglaclaw -- pnpm --dir "$PWD" banglaclaw mcp serve
```

</details>

<details>
<summary><b>Knowledge base and long-term memory</b> · <a href="docs/07-memory.md">docs</a></summary>

```bash
docker compose -f docker/compose.yaml up -d      # Postgres :54329 and Qdrant :56333
# banglaclaw.yaml: knowledge: {enabled: true, vectorStore: qdrant, vectorStoreUrl: http://localhost:56333}
#                  memory: {longTerm: {enabled: true}}
pnpm banglaclaw kb ingest docs/faq policies.pdf নীতিমালা.docx https://shop.example.com/faq
pnpm banglaclaw agent run "ঢাকার বাইরে ডেলিভারি চার্জ কত?"
```

</details>

<details>
<summary><b>Multi-agent team with human handoff</b> · <a href="docs/04-agent-runtime.md">docs</a></summary>

```bash
# banglaclaw.yaml: agents: {dirs: [examples/agents]}   handoff: {enabled: true}
pnpm banglaclaw agent list
pnpm banglaclaw agent run "1500 takar jinish e 10% discount dile koto?"   # supervisor ↪ sales
pnpm banglaclaw key create --user ops --role operator                     # operator key (Postgres)
pnpm banglaclaw handoff list                                              # conversations waiting for a human
```

</details>

<details>
<summary><b>Persistent sessions with PostgreSQL</b> · <a href="docs/13-storage.md">docs</a></summary>

```bash
docker compose -f docker/compose.yaml up -d
export BANGLACLAW_STORAGE=postgres DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw
pnpm banglaclaw db migrate
pnpm banglaclaw chat                      # prints a session id on exit
pnpm banglaclaw chat --session <id>       # resume later
pnpm banglaclaw session list
```

</details>

Run `pnpm banglaclaw --help` for the full command list, and see [Configuration](docs/16-configuration.md) for every `banglaclaw.yaml` option.

## Documentation

| Getting started | Core concepts | Integrations | Operations |
|---|---|---|---|
| [Overview](docs/00-overview.md) | [Architecture](docs/03-architecture.md) | [MCP](docs/10-mcp.md) | [Security](docs/14-security.md) |
| [Vision](docs/01-vision.md) | [Agent Runtime](docs/04-agent-runtime.md) | [Channels](docs/11-channels.md) | [Observability](docs/15-observability.md) |
| [Goals & Non-goals](docs/02-goals.md) | [Gateway](docs/05-gateway.md) | [Model Providers](docs/12-model-providers.md) | [Deployment](docs/21-deployment.md) |
| [Configuration](docs/16-configuration.md) | [Sessions](docs/06-session.md) | [API](docs/18-api.md) | [Operations](docs/22-operations.md) |
| [CLI](docs/17-cli.md) | [Memory & Knowledge](docs/07-memory.md) | [Plugins](docs/23-plugins.md) | [Storage](docs/13-storage.md) |
| [Development](docs/19-development.md) | [Skills](docs/08-skills.md) · [Tools](docs/09-tools.md) | | [Roadmap](docs/20-roadmap.md) |

Design decisions are recorded as [Architecture Decision Records](docs/adr/). Bangla versions of the gateway, skills, MCP and channels docs are in [docs/bn](docs/bn/README.md).

## Design principles

1. **TypeScript-first**, with strict types and validated external data
2. **Provider-independent**: swap models without touching agent code
3. **MCP-native** tool integration
4. **Extensible** through skills, tools and plugins
5. **Channels kept separate from the runtime**
6. **Secure by default**: deny-by-default tools, audit logs, and authorization enforced in code rather than in prompts
7. **Bangla, Banglish and English** as first-class languages
8. **Observable**: every run is traced, measured and recorded

## Project status

**v1.1.0.** All roadmap milestones (v0.1–v1.0) are complete. The `/v1` HTTP API is stable and changes only additively ([compatibility policy](docs/18-api.md#versioning-and-compatibility-v10)).

| Release | Highlights |
|---|---|
| v0.1 Agent core | LangGraph runtime, OpenAI-compatible and Anthropic providers, permission-checked tools, streaming, language detection, CLI |
| v0.2 State & skills | Sessions, PostgreSQL persistence, short-term memory, checkpoints, `SKILL.md` skills |
| v0.3 MCP | MCP client (stdio and HTTP) and the bundled Bangladesh MCP server |
| v0.4 Gateway | REST, SSE and WebSocket API with per-user keys and rate limits |
| v0.5 Channels | Telegram, WhatsApp, browser chat, allowlists |
| v0.6 Knowledge | RAG with Bangla-aware chunking and long-term memory |
| v0.7 Multi-agent | Supervisor and specialists, human handoff |
| v1.0 Production | Audit log, scopes and roles, OpenTelemetry, Prometheus, OpenAPI and typed client, plugins, Docker |
| v1.1 Professional CLI | Ink chat UI, setup wizard, `--json` output, shell completion |
| Unreleased | Admin dashboard, Messenger, voice notes, DOCX and URL sources, BanglaClaw as an MCP server, live operator replies, refreshed UIs |

See the [CHANGELOG](CHANGELOG.md) for details and the [roadmap](docs/20-roadmap.md) for what comes next.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first. Questions go to [Discussions](https://github.com/Entrogic/banglaclaw/discussions) (see [SUPPORT.md](SUPPORT.md)), and [GOVERNANCE.md](GOVERNANCE.md) explains how decisions are made. Before opening a pull request, run the same checks as CI:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

BanglaClaw is released under the [Apache License 2.0](LICENSE).
