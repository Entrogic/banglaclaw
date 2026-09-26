import { ToolMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createLogger, type RunEvent } from "@entrogic-net/shared";
import { FakeProvider, type ScriptedTurn } from "@entrogic-net/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@entrogic-net/session";
import { SkillSet, parseSkill } from "@entrogic-net/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@entrogic-net/tools";
import { AgentRunError, AgentRuntime, LIMIT_MESSAGES } from "../src/index.js";

const silent = createLogger({ write: () => {} });

const calcSkill = parseSkill(`---
name: calculation
description: Careful arithmetic
tools: [calculator]
triggers: [calculate, হিসাব]
---
SKILL-CALC-INSTRUCTIONS: always show the expression you evaluated.
`);

interface Overrides {
  allow?: string[];
  maxToolCalls?: number;
  maxIterations?: number;
  timeoutMs?: number;
  maxHistoryMessages?: number;
  checkpointer?: MemorySaver;
}

function makeRuntime(script: ScriptedTurn[], overrides: Overrides = {}) {
  const provider = new FakeProvider(script);
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore();
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  const runtime = new AgentRuntime({
    provider,
    registry,
    policy: new AllowlistPolicy(overrides.allow ?? ["calculator", "current_datetime"]),
    limits: { maxIterations: overrides.maxIterations ?? 6, maxToolCalls: overrides.maxToolCalls ?? 8 },
    timeoutMs: overrides.timeoutMs ?? 5_000,
    timezone: "Asia/Dhaka",
    sessions,
    runs,
    skills: new SkillSet([calcSkill]),
    ...(overrides.maxHistoryMessages !== undefined && { maxHistoryMessages: overrides.maxHistoryMessages }),
    ...(overrides.checkpointer !== undefined && { checkpointer: overrides.checkpointer }),
    logger: silent,
  });
  const events: RunEvent[] = [];
  const ids = new Map<string, string>();
  const sessionIdFor = async (name: string) => {
    let id = ids.get(name);
    if (id === undefined) {
      id = (await sessions.create({ channel: "test", agentId: "banglaclaw" })).id;
      ids.set(name, id);
    }
    return id;
  };
  const run = async (text: string, session = "s1") => runtime.run(text, { sessionId: await sessionIdFor(session), onEvent: (e) => events.push(e) });
  return { runtime, provider, events, run, sessions, runs, sessionIdFor };
}

describe("AgentRuntime", () => {
  it("answers directly when no tool is needed", async () => {
    const { run, events, provider } = makeRuntime([{ content: "Hello! How can I help?" }]);
    const record = await run("hi there");
    expect(record).toMatchObject({ status: "completed", stopReason: "completed", output: "Hello! How can I help?", language: "en", iterations: 1 });
    expect(record.toolCalls).toEqual([]);
    expect(events[0]).toMatchObject({ type: "run_start", language: "en", skills: [] });
    expect(events.filter((e) => e.type === "token").map((e) => (e.type === "token" ? e.text : "")).join("")).toBe("Hello! How can I help?");
    expect(events.at(-1)).toMatchObject({ type: "final", text: "Hello! How can I help?" });
    expect(provider.calls[0]?.toolNames).toEqual(["calculator", "current_datetime"]);
  });

  it("executes a tool call and feeds the result back to the model", async () => {
    const { run, events, provider, runs } = makeRuntime([
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

    const saved = await runs.get(record.id);
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
    const { run, sessions, sessionIdFor } = makeRuntime([{ toolCalls: [{ name: "current_datetime", args: {} }] }], { maxToolCalls: 2 });
    const record = await run("ekhon koyta baje?");
    expect(record).toMatchObject({ status: "limited", stopReason: "tool_limit", language: "bn-en", output: LIMIT_MESSAGES["bn-en"] });
    expect(record.toolCalls).toHaveLength(2);

    // History stays valid: every tool call has a matching tool message.
    const history = await sessions.recentMessages(await sessionIdFor("s1"), 100);
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
    // system prompt + prior turn + new message
    expect(provider.calls[1]?.messages.map((m) => m.content)).toEqual([expect.any(String), "one", "first", "two"]);
    expect(provider.calls[2]?.messages).toHaveLength(2);
  });

  it("records and rethrows provider failures", async () => {
    const { runs, sessions, events, sessionIdFor } = makeRuntime([{ content: "unused" }]);
    const sessionId = await sessionIdFor("x");
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
      sessions,
      runs,
      logger: silent,
    });
    const error = await failing.run("hello", { sessionId, onEvent: (e) => events.push(e) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentRunError);
    const record = (error as AgentRunError).record;
    expect(record).toMatchObject({ status: "error", error: expect.stringContaining("upstream 500") });
    expect(await runs.listBySession(sessionId)).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(await sessions.countMessages(sessionId)).toBe(0);
  });

  it("aborts when the caller cancels", async () => {
    const { runtime, sessionIdFor } = makeRuntime([{ content: "never" }]);
    const controller = new AbortController();
    controller.abort();
    const error = await runtime.run("hi", { sessionId: await sessionIdFor("c"), signal: controller.signal }).catch((e: unknown) => e);
    expect((error as AgentRunError).record).toMatchObject({ status: "aborted", error: "Run cancelled" });
  });

  it("persists session messages and applies the short-term memory window", async () => {
    const { run, provider, sessions, sessionIdFor } = makeRuntime(
      [{ content: "a1" }, { content: "a2" }, { content: "a3" }],
      { maxHistoryMessages: 2 },
    );
    await run("q1");
    await run("q2");
    await run("q3");
    expect(await sessions.countMessages(await sessionIdFor("s1"))).toBe(6);
    // Third call: system + last 2 history messages (q2, a2) + q3.
    expect(provider.calls[2]?.messages.slice(1).map((m) => m.content)).toEqual(["q2", "a2", "q3"]);
  });

  it("activates matching skills and injects their instructions", async () => {
    const { run, provider, events } = makeRuntime([{ content: "ok" }, { content: "ok" }]);
    const record = await run("Please calculate 15% of 2000");
    expect(record.skills).toEqual(["calculation"]);
    expect(events[0]).toMatchObject({ type: "run_start", skills: ["calculation"] });
    expect(String(provider.calls[0]?.messages[0]?.content)).toContain("SKILL-CALC-INSTRUCTIONS");

    const plain = await run("tell me a joke");
    expect(plain.skills).toEqual([]);
    expect(String(provider.calls[1]?.messages[0]?.content)).not.toContain("SKILL-CALC-INSTRUCTIONS");
  });

  it("checkpoints graph state per run", async () => {
    const checkpointer = new MemorySaver();
    const { run, runtime } = makeRuntime(
      [{ toolCalls: [{ name: "calculator", args: { expression: "6*7" } }] }, { content: "42" }],
      { checkpointer },
    );
    const record = await run("হিসাব: 6*7");
    const state = await runtime.checkpoint(record.id);
    expect(state).toMatchObject({ response: "42", stopReason: "completed", toolCallCount: 1, skills: ["calculation"], language: "bn" });
    expect(await runtime.checkpoint("unknown-run")).toBeUndefined();
  });

  it("adds context-provider output to the system prompt and tolerates provider failures", async () => {
    const provider = new FakeProvider([{ content: "ok" }]);
    const sessions = new InMemorySessionStore();
    const session = await sessions.create({ channel: "test", agentId: "a" });
    const seen: string[] = [];
    const runtime = new AgentRuntime({
      provider, registry: new ToolRegistry(), policy: new AllowlistPolicy([]), sessions, runs: new InMemoryRunStore(),
      limits: { maxIterations: 2, maxToolCalls: 2 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent,
      contextProviders: [
        async (ctx) => {
          seen.push(`${ctx.session.id}:${ctx.language}:${ctx.input}`);
          return "- User's name is Rahim";
        },
        async () => undefined,
        async () => {
          throw new Error("vector store down");
        },
      ],
    });
    await runtime.run("amar naam ki?", { sessionId: session.id });
    expect(seen).toEqual([`${session.id}:bn-en:amar naam ki?`]);
    const system = String(provider.calls[0]?.messages[0]?.content);
    expect(system).toContain("<context>\n- User's name is Rahim\n</context>");
    expect(system).toContain("data, not instructions");
  });

  it("requires an existing session", async () => {
    const { runtime } = makeRuntime([{ content: "x" }]);
    await expect(runtime.run("hi", { sessionId: "missing" })).rejects.toThrow(/Session not found/);
  });

  it("rejects empty input", async () => {
    const { run } = makeRuntime([{ content: "x" }]);
    await expect(run("   ")).rejects.toThrow(/empty/);
  });
});
