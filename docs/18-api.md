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
| GET | `/v1/sessions?limit=` | The caller's sessions, most recent first |
| GET | `/v1/sessions/:id` | Session plus message count |
| GET | `/v1/sessions/:id/messages?limit=` | Recent messages (`role`, `content`, `toolCalls`, `toolCallId`) |
| POST | `/v1/sessions/:id/messages` | Send a message, i.e. run the agent in that session: `{ text }` |
| GET | `/v1/sessions/:id/runs?limit=` | Runs of a session, with tool calls |
| GET | `/v1/runs/:id` | One run |
| GET | `/v1/knowledge/search?q=&limit=` | Search the knowledge base (when enabled) |
| GET | `/v1/knowledge/documents` | Ingested documents |
| GET | `/v1/memories` | The caller's long-term memories |
| DELETE | `/v1/memories/:id` | Delete one of the caller's memories (204) |
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
→ {"type":"ping"}                                           ← {"type":"pong"}
                                                            ← {"type":"error","ref?":"q1","error":{"code","message"}}
```

Several runs may be active on one connection (each with its own `ref`), up to the per-key concurrency limit. Closing the socket cancels its runs.

## Errors

Every error has the same shape and carries the request id (also returned in `X-Request-Id`; a valid incoming `X-Request-Id` is reused):

```json
{ "error": { "code": "session_not_found", "message": "Session not found", "requestId": "…" } }
```

| Status | Codes |
|---|---|
| 400 | `invalid_request`, `invalid_json` |
| 401 | `unauthenticated` |
| 404 | `not_found`, `session_not_found`, `run_not_found` |
| 413 | `payload_too_large` (bodies over 256 KB) |
| 429 | `rate_limited`, `too_many_concurrent_runs` (with `Retry-After`) |
| 502 | `run_failed` (model provider error) |
| 504 | `run_timeout` |

## Authentication and limits

- API keys look like `bck_<id>_<secret>`. Only a SHA-256 hash of the secret is stored. Create keys with `banglaclaw key create --user <name>` (postgres storage). In memory mode, `serve` prints a temporary key.
- Per API key: a token-bucket rate limit (`gateway.rateLimit.requestsPerMinute`, reported in `X-RateLimit-Limit` / `X-RateLimit-Remaining`) and a cap on concurrent runs (`maxConcurrentRuns`). Limits are per process; a shared store is needed for multiple instances.
