# 13 — Storage

## Primary database

PostgreSQL is the initial recommended relational database.

## Implemented (v0.2)

`storage.provider: memory` (default, zero setup) or `postgres` (requires `DATABASE_URL`).

`packages/storage` uses **Drizzle ORM** with node-postgres (ADR-0006):

| Table | Contents |
|---|---|
| `users` | unique name, role `user` / `operator` (v0.4, role v0.7) |
| `api_keys` | public key id, user_id, name, SHA-256 hash of the secret, scopes, last_used_at, revoked_at |
| `sessions` | channel, external_id (unique per channel), user_id (FK users), agent_id, status, active_agent, handoff_reason, handoff_at, timestamps |
| `messages` | session_id, run_id, role, `data` jsonb (serialised LangChain message incl. tool calls) |
| `runs` | status (incl. `handoff`), stop_reason, language, skills[], agent, agent_path[], handoff_reason, input_tokens, output_tokens, input/output/error, provider, prompt_version, timings |
| `audit_logs` | at, action, outcome, actor_id/name, target, ip, request_id, metadata (v1.0) |
| `tool_calls` | run_id + seq, tool, input/output jsonb, status, error, duration |
| `checkpoints*` | LangGraph `PostgresSaver` tables, one thread per run (`thread_id = runId`) |

- The schema lives in `packages/storage/src/schema.ts`, and migrations are generated into `packages/storage/drizzle/` with `pnpm --filter @entrogic-net/storage db:generate` and committed.
- `banglaclaw db migrate` applies the migrations and creates the checkpoint tables. With the postgres provider, the runtime refuses to start while migrations are pending.
- A run and its tool calls are inserted in a single transaction. Messages are appended in a transaction that also bumps `sessions.updated_at`.
- Local database: `docker compose -f docker/compose.yaml up -d` starts PostgreSQL 17 on `localhost:54329`, and also creates a `banglaclaw_test` database for integration tests.

## Vector storage (v0.6)

Knowledge chunks and long-term memories live in a vector store, not in PostgreSQL: Qdrant collections `banglaclaw_knowledge` and `banglaclaw_memories` (configurable), or the in-memory store. See docs/07.



## Optional infrastructure

- Redis — caching, queues and ephemeral coordination
- Qdrant — vector retrieval (implemented in v0.6)
- S3-compatible storage — files and artifacts

Storage interfaces should remain replaceable.
