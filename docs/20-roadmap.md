# 20 — Roadmap

## Phase 0 — Documentation

- [x] Project vision
- [x] Goals/non-goals
- [x] Architecture
- [x] Agent runtime design
- [x] Gateway design
- [x] Skills design
- [x] Tools design
- [x] MCP design
- [x] Security baseline
- [x] Roadmap

## v0.1 — Agent Core

- [x] TypeScript monorepo
- [x] LangGraph runtime
- [x] Model provider interface
- [x] CLI
- [x] Basic tool calling
- [x] Basic streaming

## v0.2 — State and Skills

- [x] Sessions
- [x] PostgreSQL persistence
- [x] Skills system
- [x] Short-term memory
- [x] Checkpointing

## v0.3 — MCP

- [x] MCP client
- [x] MCP tool discovery
- [x] MCP execution
- [x] Example MCP server

## v0.4 — Gateway

- [x] REST API
- [x] WebSocket/SSE
- [x] Authentication
- [x] Rate limiting

## v0.5 — Channels

- [x] Web
- [x] Telegram
- [x] WhatsApp
- [x] CLI improvements

## v0.6 — Knowledge

- [x] RAG
- [x] Qdrant integration
- [x] Document ingestion
- [x] Long-term memory

## v0.7 — Multi-agent

- [x] Supervisor
- [x] Specialist agents
- [x] Agent-to-agent workflows
- [x] Human handoff

## v1.0 — Production Runtime

- [x] Security hardening
- [x] Observability
- [x] Stable APIs
- [x] Plugin/skill ecosystem
- [x] Production documentation

## After 1.0 (ideas)

- Per-tenant knowledge collections and document ACLs
- Shared rate-limit store and session-event bus (Redis) for horizontally scaled gateways
- Router/planner/verifier graph nodes; streaming replies by editing channel messages
- Discord channel, a public web widget with visitor sessions (Facebook Messenger shipped after 1.1)
- Voice notes (speech-to-text), images, DOCX and URL loaders
- Publishing `@banglaclaw/*` packages to npm; MCP resources and prompts for the BanglaClaw MCP server
