# 16 — Configuration

Configuration should support environment variables and a project config file.

## Example

`banglaclaw.yaml` in the working directory (or `--config <path>` / `BANGLACLAW_CONFIG`). All keys are optional; see `banglaclaw.example.yaml`.

```yaml
agent:
  name: banglaclaw

models:
  default:
    provider: openai-compatible   # openai-compatible | anthropic
    model: gpt-4o-mini            # default depends on provider
    # baseUrl: http://localhost:11434/v1
    # temperature: 0.3

runtime:
  maxIterations: 6     # model calls per run
  maxToolCalls: 8      # tool executions per run
  timeoutMs: 60000

tools:
  allow: [calculator, current_datetime]

storage:
  provider: memory     # memory | postgres (needs DATABASE_URL)
  checkpoints: true    # LangGraph checkpoints per run (postgres only)

memory:
  maxHistoryMessages: 20   # short-term memory window
  longTerm:
    enabled: false         # remember/recall/forget tools (docs/07)
    autoRecall: true
    recallLimit: 5
    maxPerOwner: 200
    collection: banglaclaw_memories

embeddings:
  model: text-embedding-3-small
  # dimensions: 512
  # baseUrl: http://localhost:11434/v1

voice:                     # voice notes on channels (docs/11)
  enabled: false
  model: whisper-1         # OpenAI-compatible /audio/transcriptions
  # baseUrl: http://localhost:8000/v1
  language: bn             # hint, or auto
  maxSeconds: 120

knowledge:
  enabled: false           # search_knowledge tool
  vectorStore: memory      # memory | qdrant
  vectorStoreUrl: http://localhost:6333
  collection: banglaclaw_knowledge
  sources: []              # files, folders or http(s) URLs, ingested on start
  chunkSize: 1200
  chunkOverlap: 150
  searchLimit: 5
  minScore: 0.2

skills:
  dirs: [skills]
  builtin: true              # also load the CLI's bundled skills (a same-named configured skill wins)
  maxActive: 2

channels:
  web:
    enabled: true            # /chat page on the gateway
  telegram:
    enabled: false
    mode: polling            # polling | webhook
    # webhookUrl: https://bot.example.com
    access: allowlist        # allowlist | open
    allowedUserIds: []       # numeric Telegram user ids
    rateLimitPerMinute: 10   # per chat
  whatsapp:
    enabled: false
    # phoneNumberId: "123456789012345"
    graphApiVersion: v21.0
    access: allowlist
    allowedNumbers: []       # e.g. ["8801712345678"]
    rateLimitPerMinute: 10
  messenger:
    enabled: false
    # pageId: "104512345678901"
    graphApiVersion: v21.0
    access: allowlist        # open for a public page
    allowedUserIds: []       # page-scoped user ids (PSIDs)
    rateLimitPerMinute: 10
    humanAgentTag: false     # operator replies with the HUMAN_AGENT tag (7-day window)

agents:
  dirs: [agents]           # <dir>/<name>/AGENT.md specialists (examples/agents)
  maxTransfers: 3

handoff:
  enabled: false           # request_human tool + operator queue

gateway:
  host: 127.0.0.1          # use 0.0.0.0 only behind a reverse proxy
  port: 3000
  corsOrigins: []          # allowed browser origins; empty = CORS off
  trustProxy: false        # client IP from X-Forwarded-For (only behind a trusted proxy)
  metrics: true            # GET /metrics (protect with METRICS_TOKEN)
  # dashboardDir: apps/dashboard/dist   # built admin dashboard served at /admin
  maxInputChars: 8000
  rateLimit:
    requestsPerMinute: 60  # per API key
    maxConcurrentRuns: 2   # per API key

plugins: []                # e.g. [examples/plugins/bd-phone] — docs/23

pricing: {}                # USD per 1M tokens by provider id, for /v1/admin/stats cost estimates
# pricing:
#   "openai-compatible:gpt-4o-mini": { input: 0.15, output: 0.6 }

mcp:
  servers:
    bangladesh:
      transport: stdio          # stdio | http
      command: node
      args: [--import, tsx, mcp-servers/bangladesh/src/bin.ts]
      env: {}                   # values may use ${VAR}
      # cwd: .                  # relative to the config file
      timeoutMs: 30000          # per tool call
      connectTimeoutMs: 15000
      enabled: true
    # remote:
    #   transport: http
    #   url: https://mcp.example.com/mcp
    #   headers: { Authorization: "Bearer ${REMOTE_MCP_TOKEN}" }

timezone: Asia/Dhaka
```

`banglaclaw init` writes this template. MCP tools must also be allowed in `tools.allow`, for example `bangladesh__*`.

Unknown keys are rejected, which also prevents API keys from being written into the file.

## Environment variables

The CLI loads `./.env` (see `.env.example`) at startup. Variables already exported in the shell take precedence over the file.

| Variable | Purpose |
|---|---|
| `BANGLACLAW_PROVIDER` | Overrides `models.default.provider` (clears a file `model`/`baseUrl` written for another provider) |
| `BANGLACLAW_MODEL` | Overrides `models.default.model` |
| `BANGLACLAW_BASE_URL` | Overrides `models.default.baseUrl` |
| `BANGLACLAW_CONFIG` | Config file path |
| `BANGLACLAW_STORAGE` | Overrides `storage.provider` |
| `BANGLACLAW_GATEWAY_PORT`, `BANGLACLAW_GATEWAY_HOST` | Override `gateway.port` / `gateway.host` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Telegram channel secrets |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | WhatsApp channel secrets |
| `QDRANT_URL`, `QDRANT_API_KEY` | Override `knowledge.vectorStoreUrl`; Qdrant API key |
| `EMBEDDINGS_API_KEY` | Embeddings key (defaults to `OPENAI_API_KEY`) |
| `TRANSCRIPTION_API_KEY` | Voice-note transcription key (defaults to `OPENAI_API_KEY`) |
| `MESSENGER_PAGE_ACCESS_TOKEN`, `MESSENGER_APP_SECRET`, `MESSENGER_VERIFY_TOKEN` | Facebook Messenger channel (docs/11) |
| `METRICS_TOKEN` | Bearer token required for `GET /metrics` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (+ standard `OTEL_*`) | Enables OpenTelemetry trace export (docs/15) |
| `HANDOFF_WEBHOOK_URL` | Receives `POST {event: "handoff", sessionId, channel, reason, at}` |
| `DATABASE_URL` | PostgreSQL connection string (treated as a secret, environment only) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider secrets (environment only) |
| `BANGLACLAW_LOG_LEVEL` | `debug` \| `info` \| `warn` (default) \| `error`; JSON logs go to stderr |



## Requirements

- Environment variable overrides
- Secrets excluded from source control
- Schema validation
- Safe defaults
- Configuration diagnostics
