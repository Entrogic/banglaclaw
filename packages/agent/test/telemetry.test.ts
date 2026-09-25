import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, describe, expect, it } from "vitest";
import { FakeProvider } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore, type RunRecord } from "@banglaclaw/session";
import { createLogger } from "@banglaclaw/shared";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@banglaclaw/tools";
import { AgentRuntime } from "../src/index.js";

const exporter = new InMemorySpanExporter();
const tracerProvider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
tracerProvider.register();
afterAll(async () => {
  await tracerProvider.shutdown();
  trace.disable();
});

describe("telemetry", () => {
  it("records token usage and emits invoke_agent / chat / execute_tool spans", async () => {
    const provider = new FakeProvider([
      { toolCalls: [{ name: "calculator", args: { expression: "2+2" } }], usage: { input: 100, output: 10 } },
      { content: "4", usage: { input: 130, output: 5 } },
    ]);
    const sessions = new InMemorySessionStore();
    const registry = new ToolRegistry();
    for (const tool of builtinTools) registry.register(tool);
    const completed: RunRecord[] = [];
    const runtime = new AgentRuntime({
      provider, registry, policy: new AllowlistPolicy(["calculator"]), sessions, runs: new InMemoryRunStore(),
      limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 5_000, timezone: "Asia/Dhaka",
      logger: createLogger({ write: () => {} }),
      onRunComplete: (r) => completed.push(r),
    });
    const session = await sessions.create({ channel: "test", agentId: "a" });
    const record = await runtime.run("2+2?", { sessionId: session.id });

    expect(record.usage).toEqual({ inputTokens: 230, outputTokens: 15 });
    expect(completed.map((r) => r.id)).toEqual([record.id]);

    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === "invoke_agent banglaclaw");
    const chats = spans.filter((s) => s.name === "chat scripted");
    const tool = spans.find((s) => s.name === "execute_tool calculator");
    expect(root?.attributes).toMatchObject({ "banglaclaw.run.status": "completed", "gen_ai.usage.input_tokens": 230, "banglaclaw.agent": "supervisor" });
    expect(chats).toHaveLength(2);
    expect(chats[0]?.attributes).toMatchObject({ "gen_ai.system": "fake", "gen_ai.request.model": "scripted", "gen_ai.usage.input_tokens": 100 });
    expect(tool?.attributes).toMatchObject({ "gen_ai.tool.name": "calculator", "banglaclaw.tool.status": "ok" });
    const rootId = root?.spanContext().spanId;
    for (const child of [...chats, tool]) expect(child?.parentSpanContext?.spanId).toBe(rootId);
  });
});
