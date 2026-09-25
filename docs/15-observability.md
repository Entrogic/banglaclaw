# 15 — Observability

Every agent run should be traceable.

## Run events

```text
Agent Run
 ├── LLM call
 ├── Tool call
 ├── MCP call
 ├── latency
 ├── token usage
 ├── errors
 └── final result
```

## Planned integrations

- OpenTelemetry
- LangSmith
- Prometheus
- Grafana

The runtime should expose provider-neutral telemetry hooks.
