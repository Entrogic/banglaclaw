import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { InMemoryRunStore, InMemorySessionStore, SessionManager, hasCompleteToolCalls, trimHistory, type RunRecord } from "../src/index.js";

const toolTurn = [
  new HumanMessage("2+2?"),
  new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "calculator", args: { expression: "2+2" }, type: "tool_call" }] }),
  new ToolMessage({ tool_call_id: "c1", content: '{"result":4}' }),
  new AIMessage("4"),
];

describe("trimHistory", () => {
  it("keeps the most recent messages starting at a user turn", () => {
    const history = [new HumanMessage("hi"), new AIMessage("hello"), ...toolTurn];
    expect(trimHistory(history, 10)).toHaveLength(6);
    // Window of 3 would start at the tool result; it must advance to the next user turn (none) → empty.
    expect(trimHistory(history, 3)).toEqual([]);
    expect(trimHistory(history, 4).map((m) => m.content)).toEqual(["2+2?", "", '{"result":4}', "4"]);
    expect(trimHistory(history, 5).map((m) => m.content)[0]).toBe("2+2?");
    expect(trimHistory(history, 0)).toEqual([]);
  });

  it("never yields dangling tool calls", () => {
    const history = [new HumanMessage("a"), new AIMessage("b"), ...toolTurn, new HumanMessage("c"), new AIMessage("d")];
    for (let n = 0; n <= history.length; n++) expect(hasCompleteToolCalls(trimHistory(history, n))).toBe(true);
  });
});

describe("InMemorySessionStore + SessionManager", () => {
  it("creates, resolves and resumes sessions", async () => {
    const manager = new SessionManager(new InMemorySessionStore());
    const first = await manager.resolve({ channel: "telegram", externalId: "chat-1", agentId: "banglaclaw" });
    expect(first.created).toBe(true);
    const again = await manager.resolve({ channel: "telegram", externalId: "chat-1", agentId: "banglaclaw" });
    expect(again).toEqual({ session: first.session, created: false });
    const byId = await manager.resolve({ sessionId: first.session.id, channel: "cli", agentId: "banglaclaw" });
    expect(byId.session.id).toBe(first.session.id);
    await expect(manager.resolve({ sessionId: "nope", channel: "cli", agentId: "x" })).rejects.toThrow(/not found/);
  });

  it("stores messages and returns the recent window oldest-first", async () => {
    const store = new InMemorySessionStore();
    const s = await store.create({ channel: "cli", agentId: "a" });
    await store.appendMessages(s.id, "r1", toolTurn);
    expect(await store.countMessages(s.id)).toBe(4);
    expect((await store.recentMessages(s.id, 2)).map((m) => m.content)).toEqual(['{"result":4}', "4"]);
    await expect(store.appendMessages("missing", "r", [])).rejects.toThrow(/Unknown session/);
  });
});

describe("InMemoryRunStore", () => {
  it("lists runs by session, newest first", async () => {
    const store = new InMemoryRunStore();
    const base: RunRecord = {
      id: "r1", sessionId: "s", provider: "fake", promptVersion: "v", language: "en", skills: [], input: "hi",
      status: "completed", iterations: 1, toolCalls: [], startedAt: new Date(1000), finishedAt: new Date(2000), durationMs: 1000,
    };
    await store.save(base);
    await store.save({ ...base, id: "r2", startedAt: new Date(3000) });
    await store.save({ ...base, id: "r3", sessionId: "other" });
    expect((await store.listBySession("s")).map((r) => r.id)).toEqual(["r2", "r1"]);
    expect((await store.get("r1"))?.startedAt).toEqual(new Date(1000));
  });
});
