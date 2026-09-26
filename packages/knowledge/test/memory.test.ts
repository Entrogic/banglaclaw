import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "@entrogic-net/session";
import { AllowlistPolicy, ToolRegistry, executeTool } from "@entrogic-net/tools";
import { HashEmbedder, InMemoryVectorStore, LongTermMemory, createMemoryTools, memoryContextProvider, memoryOwner } from "../src/index.js";

function setup(maxPerOwner = 10) {
  const memory = new LongTermMemory({ store: new InMemoryVectorStore(), embedder: new HashEmbedder(), collection: "mem", maxPerOwner });
  const sessions = new InMemorySessionStore();
  const registry = new ToolRegistry();
  for (const tool of createMemoryTools(memory, sessions, { recallLimit: 5 })) registry.register(tool);
  const policy = new AllowlistPolicy(["remember", "recall", "forget"]);
  const call = (sessionId: string, name: string, args: unknown) =>
    executeTool({ id: "1", name, args }, { registry, policy, ctx: { runId: "r", sessionId, timezone: "Asia/Dhaka", signal: new AbortController().signal } });
  return { memory, sessions, call };
}

describe("memoryOwner", () => {
  it("derives owners from users, channels and the CLI", () => {
    const base = { id: "s1", agentId: "a", status: "active" as const, createdAt: new Date(), updatedAt: new Date() };
    expect(memoryOwner({ ...base, channel: "api", userId: "u1", externalId: "u1/x" })).toBe("user:u1");
    expect(memoryOwner({ ...base, channel: "telegram", externalId: "555" })).toBe("telegram:555");
    expect(memoryOwner({ ...base, channel: "cli" })).toBe("cli:local");
    expect(memoryOwner({ ...base, channel: "telegram" })).toBe("session:s1");
  });
});

describe("LongTermMemory tools", () => {
  it("remembers, recalls and forgets per owner", async () => {
    const { sessions, call } = setup();
    const rahim = await sessions.create({ channel: "telegram", externalId: "100", agentId: "a" });
    const karim = await sessions.create({ channel: "telegram", externalId: "200", agentId: "a" });

    const stored = await call(rahim.id, "remember", { fact: "User's name is Rahim and he likes cha" });
    expect(stored.audit).toMatchObject({ status: "ok", output: { stored: true, duplicate: false } });
    expect((await call(rahim.id, "remember", { fact: "User's name is Rahim and he likes cha" })).audit.output).toMatchObject({ duplicate: true });

    const recalled = (await call(rahim.id, "recall", { query: "what is the user's name" })).audit.output as { memories: { id: string; text: string }[] };
    expect(recalled.memories[0]?.text).toContain("Rahim");
    const other = (await call(karim.id, "recall", { query: "what is the user's name" })).audit.output as { memories: unknown[] };
    expect(other.memories).toEqual([]);

    const id = recalled.memories[0]?.id ?? "";
    expect((await call(karim.id, "forget", { memory_id: id })).audit.output).toEqual({ forgotten: false });
    expect((await call(rahim.id, "forget", { memory_id: id })).audit.output).toEqual({ forgotten: true });
  });

  it("refuses secrets and enforces the per-owner limit", async () => {
    const { sessions, call } = setup(2);
    const s = await sessions.create({ channel: "cli", agentId: "a" });
    expect((await call(s.id, "remember", { fact: "my password is hunter2" })).audit).toMatchObject({ status: "error", error: expect.stringMatching(/secrets/) });
    await call(s.id, "remember", { fact: "likes football a lot" });
    await call(s.id, "remember", { fact: "lives in Sylhet city" });
    expect((await call(s.id, "remember", { fact: "works as a teacher" })).audit).toMatchObject({ status: "error", error: expect.stringMatching(/limit/) });
  });

  it("provides relevant memories as run context", async () => {
    const { memory, sessions } = setup();
    const s = await sessions.create({ channel: "cli", agentId: "a" });
    await memory.remember(memoryOwner(s), "User's favourite food is biryani");
    const provide = memoryContextProvider(memory, { limit: 3 });
    const ctx = { session: s, language: "en" as const, signal: new AbortController().signal };
    expect(await provide({ ...ctx, input: "what food does the user like? favourite food" })).toContain("- User's favourite food is biryani");
    // Few memories: all are included even when the query shares no words (e.g. cross-lingual).
    expect(await provide({ ...ctx, input: "amar ki pochondo?" })).toContain("biryani");
    const empty = await sessions.create({ channel: "telegram", externalId: "9", agentId: "a" });
    expect(await provide({ ...ctx, session: empty, input: "anything" })).toBeUndefined();

    // Many memories: only the most similar are included.
    for (const fact of ["likes red cars", "plays cricket on weekends", "lives near Gulshan lake", "works at a bank"]) await memory.remember(memoryOwner(s), fact);
    const ranked = await provide({ ...ctx, input: "favourite food biryani" });
    expect(ranked?.split("\n").filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(3);
    expect(ranked).toContain("biryani");
  });
});
