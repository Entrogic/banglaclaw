# 15 — Observability

BanglaClaw exposes structured logs, Prometheus metrics, OpenTelemetry traces, token usage per run and a security audit log (docs/14).

## Logs

JSON lines on stderr (stdout is reserved for streamed replies), with `requestId`, `runId` and `sessionId` context. Secret-looking keys are redacted. Set the level with `BANGLACLAW_LOG_LEVEL` (`debug` | `info` | `warn` | `error`); `serve` defaults to `info` (one access-log line per request).

## Metrics (Prometheus)

`GET /metrics` on the gateway (`gateway.metrics: true`, the default). If `METRICS_TOKEN` is set, scrapers must send `Authorization: Bearer <token>`; otherwise protect the endpoint at the network level.

| Metric | Labels |
|---|---|
| `banglaclaw_runs_total` | status, agent, channel |
| `banglaclaw_run_duration_seconds` (histogram) | status, channel |
| `banglaclaw_tool_calls_total` | tool, status |
| `banglaclaw_model_tokens_total` | direction (input/output), provider |
| `banglaclaw_handoffs_total` | channel |
| `banglaclaw_http_requests_total` | method, route (the matched pattern, e.g. `/v1/sessions/:id`), status |
| `banglaclaw_http_request_duration_seconds` (histogram) | method, route |
| `banglaclaw_http_active_requests` | — |
| `banglaclaw_build_info` | version |
| `banglaclaw_process_*`, `banglaclaw_nodejs_*` | default Node.js process metrics |

Estimated cost = tokens × your model's price. For example, in PromQL: `sum by (provider) (rate(banglaclaw_model_tokens_total{direction="input"}[1h])) * <price per token>`.

## Traces (OpenTelemetry)

Tracing turns on when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) is set, and exports OTLP/HTTP to Jaeger, Grafana Tempo, Honeycomb, Langfuse and others. The standard `OTEL_*` variables (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SDK_DISABLED`) are honoured.

```text
GET /v1/agents/run                  (SERVER, http.route, status)
└─ invoke_agent banglaclaw          (run id, session, status, agent path, language, tokens)
   ├─ chat gpt-4o-mini              (gen_ai.system, gen_ai.request.model, gen_ai.usage.*_tokens)
   ├─ execute_tool calculator       (gen_ai.tool.name, banglaclaw.tool.status)
   └─ chat gpt-4o-mini
```

Span names and attributes follow the OpenTelemetry GenAI semantic conventions where they exist (`gen_ai.*`). `packages/agent` and `packages/gateway` depend only on `@opentelemetry/api`, which is a no-op until `@entrogic-net/observability` `initTelemetry()` registers a provider; the CLI does this for every command.

Quick local check:

```bash
docker run -d --name jaeger -p 4318:4318 -p 16686:16686 jaegertracing/jaeger:2.10.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm banglaclaw agent run "২৫ * ৪ কত?"
# open http://localhost:16686 → service "banglaclaw"
```

## Token usage

Providers report usage per model call. It is summed per run into `RunRecord.usage` (`runs.input_tokens` / `output_tokens`), returned in API run objects, exported as metrics and attached to spans.

## Audit log

Security events (failed or forbidden requests, rate limiting, key creation and revocation, tool denials, handoffs, memory deletion) are stored in `audit_logs`. Read them with `banglaclaw audit` or `GET /v1/audit` (admin role). See docs/14.
