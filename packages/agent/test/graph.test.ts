import { ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { createLogger, type RunEvent } from "@banglaclaw/shared";
import { FakeProvider, type ScriptedTurn } from "@banglaclaw/providers";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@banglaclaw/tools";
import { AgentRunError, AgentRuntime, LIMIT_MESSAGES } from "../src/index.js";

const silent = createLogger({ write: () => {} });

function makeRuntime(script: ScriptedTurn[], overrides: { allow?: string[]; maxToolCalls?: number; maxIterations?: number; timeoutMs?: number } = {}) {
  const provider = new FakeProvider(script);
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  const runtime = new AgentRuntime({
    provider,
    registry,
    policy: new AllowlistPolicy(overrides.allow ?? ["calculator", "current_datetime"]),
    limits: { maxIterations: overrides.maxIterations ?? 6, maxToolCalls: overrides.maxToolCalls ?? 8 },
    timeoutMs: overrides.timeoutMs ?? 5_000,
    timezone: "Asia/Dhaka",
    logger: silent,
  });
  const events: RunEvent[] = [];
  const run = (text: string, sessionId = "s1") => runtime.run(text, { sessionId, onEvent: (e) => events.push(e) });
  return { runtime, provider, events, run };
}

describe("AgentRuntime", () => {
  it("answers directly when no tool is needed", async () => {
    const { run, events, provider } = makeRuntime([{ content: "Hello! How can I help?" }]);
    const record = await run("hi there");
    expect(record).toMatchObject({ status: "completed", stopReason: "completed", output: "Hello! How can I help?", language: "en", iterations: 1 });
    expect(record.toolCalls).toEqual([]);
    expect(events[0]).toMatchObject({ type: "run_start", language: "en" });
    expect(events.filter((e) => e.type === "token").map((e) => (e.type === "token" ? e.text : "")).join("")).toBe("Hello! How can I help?");
    expect(events.at(-1)).toMatchObject({ type: "final", text: "Hello! How can I help?" });
    expect(provider.calls[0]?.toolNames).toEqual(["calculator", "current_datetime"]);
  });

  it("executes a tool call and feeds the result back to the model", async () => {
    const { run, events, provider, runtime } = makeRuntime([
      { toolCalls: [{ name: "calculator", args: { expression: "২৫ * ৪" } }] },
      { content: "উত্তর হলো ১০০।" },
    ]);
    const record = await run("২৫ * ৪ কত?");
    expect(record).toMatchObject({ status: "completed", language: "bn", output: "উত্তর হলো ১০০।", iterations: 2 });
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0]).toMatchObject({ tool: "calculator", status: "ok", output: { result: 100 } });

    const types = events.map((e) => e.type);
    expect(types).toEqual(["run_start", "tool_start", "tool_end", ...Array(3).fill("token"), "final"]);

    const secondCall = provider.calls[1]?.messages ?? [];
    const toolMessage = secondCall.find((m) => m instanceof ToolMessage);
    expect(toolMessage?.content).toContain('"result":100');
    expect(String(secondCall[0]?.content)).toMatch(/Bengali script/);

    const saved = await runtime.store.get(record.id);
    expect(saved?.toolCalls[0]?.status).toBe("ok");
  });

  it("does not advertise or run tools outside the allowlist", async () => {
    const { run, provider } = makeRuntime(
      [{ toolCalls: [{ name: "calculator", args: { expression: "1+1" } }] }, { content: "I can't calculate that here." }],
      { allow: ["current_datetime"] },
    );
    const record = await run("what is 1+1");
    expect(provider.calls[0]?.toolNames).toEqual(["current_datetime"]);
    expect(record.toolCalls[0]).toMatchObject({ tool: "calculator", status: "denied" });
    expect(record.status).toBe("completed");
  });

  it("stops a tool-call loop at maxToolCalls with a graceful message", async () => {
    const { run, runtime } = makeRuntime([{ toolCalls: [{ name: "current_datetime", args: {} }] }], { maxToolCalls: 2 });
    const record = await run("ekhon koyta baje?");
    expect(record).toMatchObject({ status: "limited", stopReason: "tool_limit", language: "bn-en", output: LIMIT_MESSAGES["bn-en"] });
    expect(record.toolCalls).toHaveLength(2);

    // History stays valid: every tool call has a matching tool message.
    const history = runtime.history("s1");
    const toolCallIds = history.flatMap((m) => ("tool_calls" in m && Array.isArray(m.tool_calls) ? m.tool_calls.map((c: { id?: string }) => c.id) : []));
    const toolResultIds = history.filter((m) => m instanceof ToolMessage).map((m) => (m as ToolMessage).tool_call_id);
    expect(toolResultIds.sort()).toEqual(toolCallIds.sort());
  });

  it("stops at maxIterations", async () => {
    const { run } = makeRuntime([{ toolCalls: [{ name: "current_datetime", args: {} }] }], { maxIterations: 3, maxToolCalls: 100 });
    const record = await run("loop forever");
    expect(record).toMatchObject({ status: "limited", stopReason: "iteration_limit", iterations: 3 });
  });

  it("keeps per-session history across turns", async () => {
    const { run, provider } = makeRuntime([{ content: "first" }, { content: "second" }]);
    await run("one", "a");
    await run("two", "a");
    await run("fresh", "b");
    expect(provider.calls[1]?.messages.map((m) => m.content)).toEqual([expect.any(String), "one", "first", "two"]);
    expect(provider.calls[2]?.messages).toHaveLength(2);
  });

  it("records and rethrows provider failures", async () => {
    const { runtime, events } = makeRuntime([{ content: "unused" }]);
    const failing = new AgentRuntime({
      provider: {
        id: "broken",
        chat: () => Promise.reject(new Error("boom")),
        stream: async function* () {
          throw new Error("upstream 500");
        },
      },
      registry: new ToolRegistry(),
      policy: new AllowlistPolicy([]),
      limits: { maxIterations: 2, maxToolCalls: 2 },
      timeoutMs: 5_000,
      timezone: "Asia/Dhaka",
      store: runtime.store,
      logger: silent,
    });
    const error = await failing.run("hello", { sessionId: "x", onEvent: (e) => events.push(e) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentRunError);
    const record = (error as AgentRunError).record;
    expect(record).toMatchObject({ status: "error", error: expect.stringContaining("upstream 500") });
    expect(await runtime.store.listBySession("x")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(failing.history("x")).toEqual([]);
  });

  it("aborts when the caller cancels", async () => {
    const { runtime } = makeRuntime([{ content: "never" }]);
    const controller = new AbortController();
    controller.abort();
    const error = await runtime.run("hi", { sessionId: "c", signal: controller.signal }).catch((e: unknown) => e);
    expect((error as AgentRunError).record).toMatchObject({ status: "aborted", error: "Run cancelled" });
  });

  it("rejects empty input", async () => {
    const { run } = makeRuntime([{ content: "x" }]);
    await expect(run("   ")).rejects.toThrow(/empty/);
  });
});
