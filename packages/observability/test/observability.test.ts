import { describe, expect, it } from "vitest";
import type { RunRecord, Session } from "@banglaclaw/session";
import { Metrics, initTelemetry } from "../src/index.js";

const session: Session = { id: "s", channel: "telegram", agentId: "a", status: "active", createdAt: new Date(), updatedAt: new Date() };
const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: "r", sessionId: "s", provider: "openai-compatible:gpt-4o-mini", promptVersion: "v", language: "bn", skills: [], agent: "sales", agentPath: ["supervisor", "sales"],
  input: "x", status: "completed", iterations: 2, startedAt: new Date(), finishedAt: new Date(), durationMs: 1500,
  toolCalls: [{ runId: "r", toolCallId: "1", tool: "calculator", input: {}, status: "ok", durationMs: 1 }],
  usage: { inputTokens: 200, outputTokens: 20 },
  ...over,
});

describe("Metrics", () => {
  it("exposes run, tool, token, handoff and http metrics in Prometheus format", async () => {
    const m = new Metrics({ defaultMetrics: false, version: "1.0.0" });
    m.observeRun(record(), session);
    m.observeRun(record({ status: "handoff", agent: "support", toolCalls: [] }), session);
    m.observeRun(record({ status: "handoff", agent: "human", toolCalls: [], usage: undefined }), session);
    m.observeHttp("POST", "/v1/agents/run", 200, 1234);
    const done = m.requestStarted();
    const text = await m.render();
    done();
    expect(m.contentType).toContain("text/plain");
    expect(text).toContain('banglaclaw_build_info{version="1.0.0"} 1');
    expect(text).toContain('banglaclaw_runs_total{status="completed",agent="sales",channel="telegram"} 1');
    expect(text).toContain('banglaclaw_tool_calls_total{tool="calculator",status="ok"} 1');
    expect(text).toContain('banglaclaw_model_tokens_total{direction="input",provider="openai-compatible:gpt-4o-mini"} 400');
    expect(text).toContain('banglaclaw_handoffs_total{channel="telegram"} 1');
    expect(text).toContain('banglaclaw_http_requests_total{method="POST",route="/v1/agents/run",status="200"} 1');
    expect(text).toContain("banglaclaw_http_active_requests 1");
  });
});

describe("initTelemetry", () => {
  it("is a no-op without an OTLP endpoint", async () => {
    const t = initTelemetry({ version: "1.0.0", env: {} });
    expect(t.enabled).toBe(false);
    await t.shutdown();
  });

  it("starts when an endpoint is configured", async () => {
    const t = initTelemetry({ version: "1.0.0", env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" } });
    expect(t).toMatchObject({ enabled: true, endpoint: "http://127.0.0.1:4318" });
    await t.shutdown();
  });
});
