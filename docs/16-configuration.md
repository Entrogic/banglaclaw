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

timezone: Asia/Dhaka
```

Unknown keys are rejected, which also prevents API keys from being written into the file.

## Environment variables

| Variable | Purpose |
|---|---|
| `BANGLACLAW_PROVIDER` | Overrides `models.default.provider` (clears a file `model`/`baseUrl` written for another provider) |
| `BANGLACLAW_MODEL` | Overrides `models.default.model` |
| `BANGLACLAW_BASE_URL` | Overrides `models.default.baseUrl` |
| `BANGLACLAW_CONFIG` | Config file path |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider secrets (environment only) |
| `BANGLACLAW_LOG_LEVEL` | `debug` \| `info` \| `warn` (default) \| `error`; JSON logs go to stderr |

Planned sections (`memory`, `gateway`, `mcp`) arrive with their roadmap milestones.

## Requirements

- Environment variable overrides
- Secrets excluded from source control
- Schema validation
- Safe defaults
- Configuration diagnostics
