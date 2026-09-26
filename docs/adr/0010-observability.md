# ADR-0010: OpenTelemetry Traces and Prometheus Metrics

## Status

Accepted

## Context

v1.0 needs production observability: request, run, model-call and tool-call visibility, token and cost tracking, and alerting on error rates and latency. The runtime libraries must stay lightweight and vendor-neutral.

## Decision

- **Traces.** OpenTelemetry, exported over OTLP/HTTP. Library packages (`agent`, `gateway`) depend only on `@opentelemetry/api`; `@entrogic-net/observability` registers the SDK when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Span names and attributes follow the GenAI semantic conventions (`invoke_agent`, `chat <model>`, `execute_tool <tool>`, `gen_ai.*`).
- **Metrics.** Prometheus via `prom-client`, exposed at `/metrics` on the gateway (optional bearer token). Labels are kept low-cardinality: route patterns, never ids.
- **Token usage.** Summed per run from provider `usage_metadata` and persisted on runs.

## Consequences

Positive:
- Works with Jaeger, Tempo, Honeycomb, Langfuse and others without code changes
- No overhead when tracing is off (the API no-op)
- Metrics are fed from the persisted `RunRecord`, so traces, metrics and the database agree

Trade-offs:
- Two telemetry stacks (OTel for traces, Prometheus for metrics). OTel metrics could replace prom-client later.
- The image grows by the OTel SDK and exporter
