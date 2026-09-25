# 22 — Operations

## Health and diagnostics

| Check | How |
|---|---|
| Liveness | `GET /health` → `{"status":"ok","version":…}` (also the Docker healthcheck) |
| Full self-check | `banglaclaw doctor` (config, keys, storage and migrations, MCP, channels, knowledge, plugins) |
| Schema | `banglaclaw db status` |
| Metrics and traces | docs/15 |

## Upgrades

1. Read `CHANGELOG.md`.
2. Back up PostgreSQL (below).
3. Deploy the new image or build.
4. Run `banglaclaw db migrate` (idempotent). With postgres storage, `serve` refuses to start while migrations are pending.

Migrations only add tables and columns within a major version.

## Backups

- **PostgreSQL** (sessions, messages, runs, users, keys, audit): `pg_dump -Fc -d "$DATABASE_URL" > banglaclaw-$(date +%F).dump`, restored with `pg_restore -d …`.
- **Qdrant** (knowledge chunks, long-term memories): `POST /collections/<name>/snapshots`, or back up the `qdrant` volume. Knowledge can also be rebuilt from `knowledge.sources`; memories cannot.

## API keys

```bash
banglaclaw key create --user my-app [--scopes read,run] [--role user|operator|admin]
banglaclaw key list [--user my-app]
banglaclaw key revoke <id>
```

Rotate a key by creating the new one, deploying it to the client, then revoking the old one. Every create and revoke is written to the audit log.

## Human handoff

`HANDOFF_WEBHOOK_URL` receives `{event: "handoff", sessionId, channel, reason, at}`. Point it at Slack, Discord or n8n to alert operators. Operators then run:

```bash
banglaclaw handoff list
banglaclaw handoff show <sessionId>
banglaclaw handoff reply <sessionId> "…" --as karim
banglaclaw handoff release <sessionId>
```

The same actions are available at `/v1/handoffs` (operator role).

## Audit log

```bash
banglaclaw audit --limit 50
banglaclaw audit --action auth.failed
```

Or use `GET /v1/audit?action=…` (admin role). Failed-auth and rate-limit events are throttled per source so floods can't fill the table. Prune old rows as your retention policy requires:

```sql
DELETE FROM audit_logs WHERE at < now() - interval '180 days';
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Database schema is behind` | Run `banglaclaw db migrate` |
| 401 on every request | Missing `Bearer` prefix, revoked key, or a key from another database |
| 403 `insufficient_scope` | A read-only key used for runs; create one with `--scopes read,run` |
| 429 `too_many_concurrent_runs` | Raise `gateway.rateLimit.maxConcurrentRuns`, or have clients wait |
| Telegram bot silent | The sender isn't in `allowedUserIds` (check `senderId` in the log), or a webhook is still set while polling |
| `Qdrant collection … dimensions` | The embedding model changed; use a new `collection` name |
| MCP server `failed` in `doctor` | The command isn't on PATH in the container, or an env `${VAR}` is missing |
| Streaming stalls behind a proxy | Disable proxy buffering (docs/21) |
