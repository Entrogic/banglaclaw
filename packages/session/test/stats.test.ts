import { describe, expect, it } from "vitest";
import { InMemoryRunStore, InMemorySessionStore, dayRange, type RunRecord } from "../src/index.js";

export function makeRun(over: Partial<RunRecord>): RunRecord {
  const at = over.startedAt ?? new Date("2026-09-20T10:00:00Z");
  return {
    id: crypto.randomUUID(), sessionId: "s", provider: "openai-compatible:gpt-4o-mini", promptVersion: "v", language: "bn", skills: [],
    agent: "supervisor", agentPath: ["supervisor"], input: "x", status: "completed", iterations: 1, toolCalls: [],
    startedAt: at, finishedAt: at, durationMs: 1000, ...over,
  };
}

describe("run stats", () => {
  it("zero-fills days in a timezone", () => {
    // 2026-09-19T20:00Z is already the 20th in Dhaka (+06:00).
    expect(dayRange(new Date("2026-09-19T20:00:00Z"), new Date("2026-09-22T05:00:00Z"), "Asia/Dhaka")).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
  });

  it("aggregates runs, tokens, channels, agents and tools", async () => {
    const sessions = new InMemorySessionStore();
    const tg = await sessions.create({ channel: "telegram", externalId: "1", agentId: "a" });
    const api = await sessions.create({ channel: "api", agentId: "a" });
    const runs = new InMemoryRunStore(sessions);
    const tool = (name: string, status: "ok" | "error") => ({ runId: "r", toolCallId: "t", tool: name, input: {}, status, durationMs: 1 });
    await runs.save(makeRun({ sessionId: tg.id, usage: { inputTokens: 100, outputTokens: 10 }, toolCalls: [tool("calculator", "ok"), tool("transfer_to_sales", "ok")], agent: "sales", agentPath: ["supervisor", "sales"] }));
    await runs.save(makeRun({ sessionId: tg.id, status: "error", durationMs: 3000, startedAt: new Date("2026-09-21T10:00:00Z"), toolCalls: [tool("calculator", "error")] }));
    await runs.save(makeRun({ sessionId: api.id, status: "handoff", usage: { inputTokens: 50, outputTokens: 5 }, startedAt: new Date("2026-09-21T11:00:00Z") }));
    await runs.save(makeRun({ sessionId: api.id, agent: "human", provider: "operator:karim" })); // excluded
    await runs.save(makeRun({ sessionId: api.id, startedAt: new Date("2026-08-01T00:00:00Z") })); // out of range

    const s = await runs.stats({ since: new Date("2026-09-20T00:00:00Z"), until: new Date("2026-09-21T23:00:00Z"), timezone: "UTC" });
    expect(s.totals).toEqual({ runs: 3, completed: 1, errors: 1, limited: 0, aborted: 0, handoffs: 1, inputTokens: 150, outputTokens: 15, avgDurationMs: 1667, sessions: 2 });
    expect(s.daily).toEqual([
      { date: "2026-09-20", runs: 1, errors: 0, handoffs: 0, inputTokens: 100, outputTokens: 10 },
      { date: "2026-09-21", runs: 2, errors: 1, handoffs: 1, inputTokens: 50, outputTokens: 5 },
    ]);
    expect(s.byChannel).toEqual([{ channel: "telegram", runs: 2 }, { channel: "api", runs: 1 }]);
    expect(s.byAgent).toEqual([{ agent: "supervisor", runs: 2 }, { agent: "sales", runs: 1 }]);
    expect(s.topTools).toEqual([{ tool: "calculator", calls: 2, failures: 1 }]);
    expect(s.byProvider).toEqual([{ provider: "openai-compatible:gpt-4o-mini", runs: 3, inputTokens: 150, outputTokens: 15 }]);
  });

  it("searches sessions by id prefix or external id", async () => {
    const sessions = new InMemorySessionStore();
    const a = await sessions.create({ channel: "telegram", externalId: "8801712345678", agentId: "a" });
    await sessions.create({ channel: "cli", agentId: "a" });
    expect((await sessions.list({ query: "8801712" })).map((s) => s.id)).toEqual([a.id]);
    expect((await sessions.list({ query: a.id.slice(0, 6) })).map((s) => s.id)).toContain(a.id);
  });
});
