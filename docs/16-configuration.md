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

skills:
  dirs: [skills]
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

gateway:
  host: 127.0.0.1          # use 0.0.0.0 only behind a reverse proxy
  port: 3000
  corsOrigins: []          # allowed browser origins; empty = CORS off
  maxInputChars: 8000
  rateLimit:
    requestsPerMinute: 60  # per API key
    maxConcurrentRuns: 2   # per API key

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
| `DATABASE_URL` | PostgreSQL connection string (treated as a secret, environment only) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider secrets (environment only) |
| `BANGLACLAW_LOG_LEVEL` | `debug` \| `info` \| `warn` (default) \| `error`; JSON logs go to stderr |



## Requirements

- Environment variable overrides
- Secrets excluded from source control
- Schema validation
- Safe defaults
- Configuration diagnostics
