import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { RunRecord, Session } from "@banglaclaw/session";

/** Prometheus metrics for runs, tools, tokens, handoffs and HTTP (scraped from GET /metrics). */
export class Metrics {
  readonly registry = new Registry();
  readonly #runs: Counter;
  readonly #runDuration: Histogram;
  readonly #toolCalls: Counter;
  readonly #tokens: Counter;
  readonly #handoffs: Counter;
  readonly #http: Counter;
  readonly #httpDuration: Histogram;
  readonly #active: Gauge;

  constructor(options: { defaultMetrics?: boolean; version?: string } = {}) {
    const registers = [this.registry];
    if (options.defaultMetrics !== false) collectDefaultMetrics({ register: this.registry, prefix: "banglaclaw_" });
    new Gauge({ name: "banglaclaw_build_info", help: "Build information", labelNames: ["version"], registers }).set({ version: options.version ?? "unknown" }, 1);
    this.#runs = new Counter({ name: "banglaclaw_runs_total", help: "Agent runs by outcome", labelNames: ["status", "agent", "channel"], registers });
    this.#runDuration = new Histogram({
      name: "banglaclaw_run_duration_seconds",
      help: "Agent run duration",
      labelNames: ["status", "channel"],
      buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 40, 60, 120],
      registers,
    });
    this.#toolCalls = new Counter({ name: "banglaclaw_tool_calls_total", help: "Tool calls by tool and status", labelNames: ["tool", "status"], registers });
    this.#tokens = new Counter({ name: "banglaclaw_model_tokens_total", help: "Model tokens by direction and provider", labelNames: ["direction", "provider"], registers });
    this.#handoffs = new Counter({ name: "banglaclaw_handoffs_total", help: "Conversations handed to a human", labelNames: ["channel"], registers });
    this.#http = new Counter({ name: "banglaclaw_http_requests_total", help: "Gateway HTTP requests", labelNames: ["method", "route", "status"], registers });
    this.#httpDuration = new Histogram({
      name: "banglaclaw_http_request_duration_seconds",
      help: "Gateway HTTP request duration (streaming responses measure time to first byte)",
      labelNames: ["method", "route"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers,
    });
    this.#active = new Gauge({ name: "banglaclaw_http_active_requests", help: "Gateway requests in flight", registers });
  }

  /** Pass as AgentRuntimeOptions.onRunComplete. */
  observeRun = (record: RunRecord, session: Session): void => {
    const channel = session.channel;
    this.#runs.inc({ status: record.status, agent: record.agent, channel });
    if (record.agent !== "human") this.#runDuration.observe({ status: record.status, channel }, record.durationMs / 1000);
    for (const call of record.toolCalls) this.#toolCalls.inc({ tool: call.tool, status: call.status });
    if (record.usage !== undefined) {
      this.#tokens.inc({ direction: "input", provider: record.provider }, record.usage.inputTokens);
      this.#tokens.inc({ direction: "output", provider: record.provider }, record.usage.outputTokens);
    }
    if (record.status === "handoff" && record.agent !== "human") this.#handoffs.inc({ channel });
  };

  /** Pass as GatewayDeps.metrics.onRequest. `route` must be the matched pattern (low cardinality). */
  observeHttp = (method: string, route: string, status: number, durationMs: number): void => {
    this.#http.inc({ method, route, status: String(status) });
    this.#httpDuration.observe({ method, route }, durationMs / 1000);
  };

  requestStarted = (): (() => void) => {
    this.#active.inc();
    return () => this.#active.dec();
  };

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
