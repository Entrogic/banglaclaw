# 18 — API

The v0.4 gateway (`packages/gateway`, started with `banglaclaw serve`) exposes a versioned HTTP API. All `/v1` routes require `Authorization: Bearer <api key>`. JSON uses camelCase.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check (no auth) |
| GET | `/v1/me` | The authenticated user and key |
| GET | `/v1/agents` | Default agent, model, allowed tools, skills |
| GET | `/v1/tools` | Registered tools (built-in and MCP) with risk and allowed flag |
| GET | `/v1/skills` | Discovered skills |
| POST | `/v1/agents/run` | Run the agent: `{ text, sessionId?, externalId? }`. Resumes or creates a session |
| POST | `/v1/sessions` | Create or resolve a session: `{ externalId? }` (201 when created) |
| GET | `/v1/sessions?limit=&q=` | The caller's sessions, most recent first, each with `title`; `q` matches the title, an id prefix or the external id |
| GET | `/v1/sessions/:id` | Session plus message count |
| PATCH | `/v1/sessions/:id` | Rename: `{ title }` (1–80 characters, or `null` to clear) |
| DELETE | `/v1/sessions/:id` | Delete the session with its messages and runs (204, audited as `session.deleted`) |
| GET | `/v1/sessions/:id/messages?limit=` | Recent messages (`role`, `content`, `toolCalls`, `toolCallId`) |
| POST | `/v1/sessions/:id/messages` | Send a message, i.e. run the agent in that session: `{ text }` |
| GET | `/v1/sessions/:id/runs?limit=` | Runs of a session, with tool calls |
| GET | `/v1/sessions/:id/events` | Follow a session over SSE: operator replies and handoff releases as they happen (see below) |
| GET | `/v1/runs/:id` | One run |
| GET | `/v1/knowledge/search?q=&limit=` | Search the knowledge base (when enabled) |
| GET | `/v1/knowledge/documents` | Ingested documents |
| GET | `/v1/features` | Optional features on this gateway: `{ workspace, uploads: { maxBytes } \| null, transcription }` |
| GET | `/v1/workspace/files?path=` | The caller's workspace files (docs/24); 404 `workspace_disabled` when off |
| GET | `/v1/workspace/file?path=&download=1` | A file's text as JSON, or as a `text/plain` attachment |
| DELETE | `/v1/workspace/file?path=` | Move a file to the trash |
| GET | `/v1/workspace/history?path=` | Earlier versions and whether a deleted copy is in the trash |
| POST | `/v1/workspace/restore` | Undo: `{ path, version? }` restores from the trash or history |
| POST | `/v1/workspace/uploads?filename=` | Raw file body (up to `workspace.maxUploadBytes`) → `uploads/…` (PDF/DOCX/HTML stored as text) → `{ path, characters }` (201) |
| POST | `/v1/transcriptions?language=` | Raw audio body (`audio/webm`, `audio/ogg`, `audio/mp4`…, up to 25 MB) → `{ text }`; needs `voice.enabled` |
| GET | `/v1/memories` | The caller's long-term memories |
| DELETE | `/v1/memories/:id` | Delete one of the caller's memories (204) |
| GET | `/v1/handoffs` | Operators: sessions waiting for a human (all users) |
| GET | `/v1/handoffs/:id` | Operators: a handed-off session with its messages |
| POST | `/v1/handoffs/:id/reply` | Operators: reply as a human `{ text }` → `{ delivered, runId }` (delivered through Telegram/WhatsApp/Messenger) |
| POST | `/v1/handoffs/:id/release` | Operators: return the session to the bot (409 if it isn't handed off) |
| GET | `/v1/audit?action=&limit=` | Admins: security audit log |
| GET | `/v1/admin/stats?days=` | Admins: run analytics for the last `days` (1–90, default 7) |
| GET | `/v1/admin/sessions?status=&channel=&q=&limit=` | Admins: sessions of all users with owner and message count; `q` matches an id prefix or part of the external id |
| GET | `/v1/admin/sessions/:id` | Admins: any session with its messages and runs |
| GET | `/v1/admin/keys` | Admins: all API keys (never the hash) |
| POST | `/v1/admin/keys` | Admins: issue a key `{ user, name?, role?, scopes? }` → `{ key, token }` (201); the token is shown once |
| POST | `/v1/admin/keys/:id/revoke` | Admins: revoke a key (409 for the key making the request) |
| GET | `/v1/openapi.json` | OpenAPI 3.1 spec (no auth) |
| GET | `/metrics` | Prometheus metrics (no API key; `METRICS_TOKEN` if set) |
| GET | `/admin/` | Admin dashboard static files when `gateway.dashboardDir` is set (no API key; the page calls `/v1/admin` with an admin key) |
| GET | `/v1/ws` | WebSocket (see below) |

- `externalId` is the channel-native conversation id (for example a chat id). It is namespaced per user, so two API users never share or discover each other's sessions.
- Sessions, messages and runs of other users always return `404`.
- Run responses (JSON): `{ sessionId, sessionCreated, reply, run }`. The session id is also sent in the `X-Session-Id` header.

## Streaming (SSE)

Add `?stream=true` or `Accept: text/event-stream` to either run endpoint. Events:

```text
event: session    data: {"sessionId":"…","created":true}
event: run_start  data: {"type":"run_start","runId":"…","language":"bn","skills":["calculation"]}
event: tool_start data: {"type":"tool_start","tool":"calculator","input":{…}}
event: tool_end   data: {"type":"tool_end","audit":{"status":"ok",…}}
event: agent_transfer data: {"type":"agent_transfer","from":"supervisor","to":"sales"}
event: handoff    data: {"type":"handoff","reason":"…","pending":false}   (pending: true while a human owns the session)
event: token      data: {"type":"token","text":"…"}
event: final      data: {"type":"final","text":"…"}       (or event: error)
event: done       data: {"sessionId":"…","run":{…}}
```

If the client disconnects, the run is cancelled.

## WebSocket

`GET /v1/ws`. Authenticate either with an `Authorization` header on the upgrade (server clients) or with a first message (browsers). Unauthenticated connections close with code `4401` after 10 seconds.

```text
→ {"type":"auth","apiKey":"bck_…"}                         ← {"type":"ready","user":{…}}
→ {"type":"run","ref":"q1","text":"…","sessionId?":"…"}    ← {"type":"event","ref":"q1","event":{RunEvent}}
                                                            ← {"type":"done","ref":"q1","sessionId":"…","run":{…}}
→ {"type":"cancel","ref":"q1"}
→ {"type":"subscribe","sessionId":"…"}                      ← {"type":"subscribed","sessionId":"…"}
                                                            ← {"type":"session_event","sessionId":"…","event":{SessionEvent}}
→ {"type":"unsubscribe","sessionId":"…"}
→ {"type":"ping"}                                           ← {"type":"pong"}
                                                            ← {"type":"error","ref?":"q1","error":{"code","message"}}
```

Several runs may be active on one connection (each with its own `ref`), up to the per-key concurrency limit. Closing the socket cancels its runs. A connection may follow up to 20 sessions it owns (`subscribe` needs the `read` scope; another user's session answers `session_not_found`).

## Session events

While a session is handed off, a human operator's replies don't come from a run, so clients learn about them by following the session, either over the WebSocket (`subscribe`) or with Server-Sent Events:

```text
GET /v1/sessions/:id/events            (Accept: text/event-stream)
event: ready             data: {"sessionId":"…","status":"handoff"}
event: operator_message  data: {"type":"operator_message","sessionId":"…","text":"…","at":"…"}
event: handoff_released  data: {"type":"handoff_released","sessionId":"…","at":"…"}
event: ping              data: {}                  (every 25 s)
```

- Only the session's owner can follow it. At most 10 event streams may be open per API key (429 `too_many_event_streams`).
- `POST /v1/handoffs/:id/reply` reports `delivered: true` when the reply reached a connected follower or the session's platform (Telegram, WhatsApp, Messenger). Replies are always stored, so a client that wasn't connected finds them in `/messages`.
- The web chat (`/chat`) follows its session automatically. With the SDK: `for await (const e of bc.sessions.events(id, { signal })) …`.
- Events are published in the gateway process that handled the operator's request; horizontally scaled gateways need a shared bus (docs/20).

## Errors

Every error has the same shape and carries the request id (also returned in `X-Request-Id`; a valid incoming `X-Request-Id` is reused):

```json
{ "error": { "code": "session_not_found", "message": "Session not found", "requestId": "…" } }
```

| Status | Codes |
|---|---|
| 400 | `invalid_request`, `invalid_json` |
| 401 | `unauthenticated` |
| 403 | `forbidden` (role required), `insufficient_scope` |
| 409 | `not_handed_off` |
| 404 | `not_found`, `session_not_found`, `run_not_found` |
| 413 | `payload_too_large` (bodies over 256 KB) |
| 429 | `rate_limited`, `too_many_concurrent_runs` (with `Retry-After`), `too_many_event_streams`, `too_many_subscriptions` (WebSocket) |
| 502 | `run_failed` (model provider error) |
| 504 | `run_timeout` |

## Versioning and compatibility (v1.0)

- **`/v1` is stable.** Within v1, changes are additive only: new endpoints, new optional request fields, new response fields and new event types. Clients must ignore unknown fields and SSE events.
- **Deprecations** are announced in `CHANGELOG.md` and signalled with `Deprecation` and `Sunset` response headers at least one minor release before removal. Breaking changes ship as `/v2`, with `/v1` served alongside for a transition period.
- **The machine-readable contract** is `GET /v1/openapi.json` (OpenAPI 3.1, no auth). A test fails if a route is added without being documented.
- **Typed client:** `@entrogic-net/client`.

```ts
import { BanglaClawClient } from "@entrogic-net/client";

const bc = new BanglaClawClient({ baseUrl: "https://bot.example.com", apiKey: process.env.BANGLACLAW_KEY! });
const { reply, sessionId } = await bc.run("১৫০০ টাকার ১০% কত?");
for await (const e of bc.sessions.stream(sessionId, "ar 20%?")) if (e.event === "token") process.stdout.write(e.data.text);
```

## Authentication and limits

- Keys have **scopes**: `read` (GET endpoints) and `run` (agent runs and other writes). The default is both; `key create --scopes read` makes a read-only key. Missing scope → 403 `insufficient_scope`.
- Users have a `role`: `user` (default), `operator` (may use `/v1/handoffs`) or `admin` (operator rights plus `GET /v1/audit` and `/v1/admin`). Create operators with `banglaclaw key create --user <name> --role operator`.
- API keys look like `bck_<id>_<secret>`. Only a SHA-256 hash of the secret is stored. Create keys with `banglaclaw key create --user <name>` (postgres storage). In memory mode, `serve` prints a temporary admin key that is valid until the process exits (it also opens `/admin`); keep memory mode off shared or public hosts.
- Per API key: a token-bucket rate limit (`gateway.rateLimit.requestsPerMinute`, reported in `X-RateLimit-Limit` / `X-RateLimit-Remaining`) and a cap on concurrent runs (`maxConcurrentRuns`). Limits are per process; a shared store is needed for multiple instances.

## Admin analytics

`GET /v1/admin/stats` aggregates the persisted runs, so it agrees with `/metrics` and the database. Operator replies and messages stored while a session is handed off are not counted as runs. The response has:

- `totals`: runs by status, handoffs, input and output tokens, average duration and distinct sessions
- `daily`: one zero-filled entry per day, bucketed in the configured `timezone`
- `byChannel`, `byProvider` and `byAgent` breakdowns
- `topTools`: the 10 most-called tools with failure counts (the `transfer_to_*` and `request_human` control tools are excluded)

When `pricing` lists a provider id (for example `openai-compatible:gpt-4o-mini`), its `byProvider` entry gets `costUsd` and the response gets `totalCostUsd`. Both are estimates from token counts. Providers without a price get no cost.

### Dashboard

`apps/dashboard` (Vite + React, ADR-0011) is the web UI for these endpoints and the other admin-relevant ones: overview charts, a sessions browser with transcripts and runs, the handoff queue (reply as operator, release; the nav shows how many are waiting), the agent's model, tools and skills, knowledge documents with a search tester, API-key management and the audit log. `pnpm build` writes it to `apps/dashboard/dist`; set `gateway.dashboardDir` to that directory (the Docker image does) and open `/admin/`. It signs in with an admin key kept in `sessionStorage` for that tab only, and a 401 on any call signs out. For UI work, `pnpm --filter @entrogic-net/dashboard demo` starts a gateway with seeded in-memory data and prints an admin key, and `pnpm --filter @entrogic-net/dashboard dev` serves the page with hot reload at `http://localhost:5173/admin/`, proxying `/v1` to it (or to `BANGLACLAW_GATEWAY_URL`).

Key creation and revocation through `/v1/admin/keys` are audited (`key.created`, `key.revoked` with `via: "api"`), the same as the CLI `key` commands. `POST` routes need the `run` scope.
