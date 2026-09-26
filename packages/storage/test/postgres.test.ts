import { readFileSync } from "node:fs";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "@entrogic-net/agent";
import { FakeProvider } from "@entrogic-net/providers";
import { ApiKeyAuthenticator } from "@entrogic-net/auth";
import { SessionManager, type RunRecord } from "@entrogic-net/session";
import { createLogger } from "@entrogic-net/shared";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@entrogic-net/tools";
import { PostgresStorage } from "../src/index.js";

/**
 * Integration tests against a real PostgreSQL. They TRUNCATE tables, so point
 * TEST_DATABASE_URL at a dedicated database, e.g. the banglaclaw_test DB from docker/compose.yaml:
 *   TEST_DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw_test
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(url === undefined)("PostgresStorage", () => {
  let storage: PostgresStorage;

  beforeAll(async () => {
    storage = new PostgresStorage(url as string, { maxConnections: 4 });
    await storage.migrate();
    await storage.migrate(); // idempotent
  });

  beforeEach(async () => {
    await storage.pool.query(
      "TRUNCATE users, api_keys, sessions, runs, messages, tool_calls, audit_logs, checkpoints, checkpoint_blobs, checkpoint_writes CASCADE",
    );
  });

  afterAll(async () => {
    await storage?.close();
  });

  it("reports migration status", async () => {
    const status = await storage.migrationStatus();
    expect(status.applied).toBe(status.available);
    expect(status.available).toBeGreaterThan(0);
  });

  it("stores the first user message as the title, searchable, and backfills older sessions in the migration", async () => {
    const session = await storage.sessions.create({ channel: "api", agentId: "banglaclaw" });
    const run = baseRun(session.id);
    await storage.runs.save(run);
    const runId = run.id;
    await storage.sessions.appendMessages(session.id, runId, [new HumanMessage("  ঢাকার বাইরে   ডেলিভারি চার্জ কত? "), new AIMessage("৳120")]);
    await storage.sessions.appendMessages(session.id, runId, [new HumanMessage("ar Chattogram?")]);
    expect((await storage.sessions.get(session.id))?.title).toBe("ঢাকার বাইরে ডেলিভারি চার্জ কত?");
    expect((await storage.sessions.list({ query: "ডেলিভারি" })).map((s) => s.id)).toEqual([session.id]);

    // Sessions stored before titles existed get one from the migration's backfill statement.
    await storage.pool.query("UPDATE sessions SET title = NULL");
    const migration = readFileSync(new URL("../drizzle/0005_session_titles.sql", import.meta.url), "utf8");
    const backfill = migration.split("--> statement-breakpoint").find((s) => s.includes("UPDATE"));
    if (backfill === undefined) throw new Error("backfill statement missing");
    await storage.pool.query(backfill);
    expect((await storage.sessions.get(session.id))?.title).toBe("ঢাকার বাইরে ডেলিভারি চার্জ কত?");
  });

  it("creates, finds and lists sessions", async () => {
    const manager = new SessionManager(storage.sessions);
    const { session, created } = await manager.resolve({ channel: "telegram", externalId: "42", agentId: "banglaclaw" });
    expect(created).toBe(true);
    expect(session).toMatchObject({ channel: "telegram", externalId: "42", agentId: "banglaclaw" });
    expect(session).not.toHaveProperty("userId");

    const again = await manager.resolve({ channel: "telegram", externalId: "42", agentId: "banglaclaw" });
    expect(again.session.id).toBe(session.id);
    expect(await storage.sessions.get("not-a-uuid")).toBeUndefined();

    await storage.sessions.create({ channel: "cli", agentId: "banglaclaw" });
    expect(await storage.sessions.list({ channel: "cli" })).toHaveLength(1);
    expect(await storage.sessions.list()).toHaveLength(2);
    await expect(storage.sessions.create({ channel: "telegram", externalId: "42", agentId: "x" })).rejects.toThrow();
    const handed = await storage.sessions.update(session.id, { status: "handoff", handoffReason: "angry customer", activeAgent: "support" });
    expect(handed).toMatchObject({ status: "handoff", handoffReason: "angry customer", activeAgent: "support" });
    expect(handed?.handoffAt).toBeInstanceOf(Date);
    expect((await storage.sessions.list({ status: "handoff" })).map((s) => s.id)).toEqual([session.id]);
    const released = await storage.sessions.update(session.id, { status: "active", activeAgent: null });
    expect(released).toMatchObject({ status: "active" });
    expect(released).not.toHaveProperty("handoffReason");
    expect(released).not.toHaveProperty("activeAgent");
    await storage.sessions.detachExternalId(session.id);
    expect(await storage.sessions.findByExternalId("telegram", "42")).toBeUndefined();
    expect((await manager.resolve({ channel: "telegram", externalId: "42", agentId: "banglaclaw" })).created).toBe(true);
  });

  it("stores users and API keys, and scopes sessions to users", async () => {
    const auth = new ApiKeyAuthenticator(storage.auth);
    const issued = await auth.issueKey("shop-bot", "prod");
    expect(await auth.authenticate(issued.token)).toMatchObject({ user: { name: "shop-bot" }, key: { name: "prod" } });
    expect((await storage.auth.getApiKey(issued.key.id))?.lastUsedAt).toBeInstanceOf(Date);
    await expect(storage.auth.createUser("shop-bot")).rejects.toThrow();

    const other = await storage.auth.createUser("other");
    await storage.sessions.create({ channel: "api", agentId: "a", userId: issued.user.id });
    await storage.sessions.create({ channel: "api", agentId: "a", userId: other.id });
    expect(await storage.sessions.list({ userId: issued.user.id })).toHaveLength(1);

    expect(await storage.auth.revokeApiKey(issued.key.id)).toBe(true);
    expect(await storage.auth.revokeApiKey(issued.key.id)).toBe(false);
    expect(await auth.authenticate(issued.token)).toBeUndefined();
    expect((await storage.auth.listUsers()).map((u) => u.name)).toEqual(["other", "shop-bot"]);

    const reader = await auth.issueKey("reader", "ro", undefined, ["read"]);
    expect((await auth.authenticate(reader.token))?.key.scopes).toEqual(["read"]);

    await storage.audit.record({ action: "key.created", outcome: "success", actorId: "cli", target: reader.key.id, metadata: { scopes: ["read"] } });
    await storage.audit.record({ action: "auth.failed", outcome: "failure", ip: "10.0.0.9", requestId: "r1" });
    const audit = await storage.audit.list();
    expect(audit.map((e) => e.action)).toEqual(["auth.failed", "key.created"]);
    expect(audit[1]).toMatchObject({ actorId: "cli", target: reader.key.id, metadata: { scopes: ["read"] } });
    expect(await storage.audit.list({ action: "auth.failed" })).toHaveLength(1);

    const ops = await auth.issueKey("ops", "console", "operator");
    expect(ops.user.role).toBe("operator");
    expect((await auth.authenticate(ops.token))?.user.role).toBe("operator");
  });

  it("round-trips messages including tool calls, oldest first", async () => {
    const s = await storage.sessions.create({ channel: "cli", agentId: "banglaclaw" });
    const batch = [
      new HumanMessage("২+২?"),
      new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "calculator", args: { expression: "2+2" }, type: "tool_call" }] }),
      new ToolMessage({ tool_call_id: "c1", name: "calculator", content: '{"result":4}' }),
      new AIMessage("৪"),
    ];
    await expect(storage.sessions.appendMessages(crypto.randomUUID(), crypto.randomUUID(), [])).rejects.toThrow(/Unknown session/);

    const run = baseRun(s.id);
    await storage.runs.save(run);
    await storage.sessions.appendMessages(s.id, run.id, batch);

    expect(await storage.sessions.countMessages(s.id)).toBe(4);
    const loaded = await storage.sessions.recentMessages(s.id, 3);
    expect(loaded.map((m) => m.getType())).toEqual(["ai", "tool", "ai"]);
    expect((loaded[0] as AIMessage).tool_calls?.[0]).toMatchObject({ id: "c1", name: "calculator", args: { expression: "2+2" } });
    expect((loaded[1] as ToolMessage).tool_call_id).toBe("c1");
    expect(loaded[2]?.content).toBe("৪");
  });

  it("saves runs with tool calls and lists them newest first", async () => {
    const s = await storage.sessions.create({ channel: "cli", agentId: "banglaclaw" });
    const first = baseRun(s.id, { startedAt: new Date("2026-01-01T00:00:00Z") });
    const second = baseRun(s.id, {
      startedAt: new Date("2026-01-02T00:00:00Z"),
      skills: ["calculation"],
      stopReason: "completed",
      output: "4",
      agent: "sales",
      agentPath: ["banglaclaw", "sales"],
      usage: { inputTokens: 120, outputTokens: 30 },
      toolCalls: [
        { runId: "", toolCallId: "c1", tool: "calculator", input: { expression: "2+2" }, status: "ok", output: { result: 4 }, durationMs: 1 },
        { runId: "", toolCallId: "c2", tool: "shell", input: {}, status: "unknown_tool", error: "No tool", durationMs: 0 },
      ],
    });
    await storage.runs.save(first);
    await storage.runs.save(second);

    const got = await storage.runs.get(second.id);
    expect(got).toMatchObject({ id: second.id, skills: ["calculation"], output: "4", stopReason: "completed", language: "bn", agent: "sales", agentPath: ["banglaclaw", "sales"], usage: { inputTokens: 120, outputTokens: 30 } });
    expect(got?.toolCalls.map((c) => [c.toolCallId, c.status])).toEqual([["c1", "ok"], ["c2", "unknown_tool"]]);
    expect(got?.toolCalls[0]?.runId).toBe(second.id);
    expect(got).not.toHaveProperty("error");

    expect((await storage.runs.listBySession(s.id)).map((r) => r.id)).toEqual([second.id, first.id]);
    expect(await storage.runs.get("nope")).toBeUndefined();
  });

  it("aggregates run stats and searches sessions in SQL", async () => {
    const tg = await storage.sessions.create({ channel: "telegram", externalId: "8801712345678", agentId: "a" });
    const api = await storage.sessions.create({ channel: "api", agentId: "a" });
    const tool = (name: string, status: "ok" | "error") => ({ runId: "", toolCallId: crypto.randomUUID(), tool: name, input: {}, status, durationMs: 1 });
    const at = (iso: string) => ({ startedAt: new Date(iso), finishedAt: new Date(iso) });
    await storage.runs.save(baseRun(tg.id, { ...at("2026-09-20T10:00:00Z"), usage: { inputTokens: 100, outputTokens: 10 }, agent: "sales", toolCalls: [tool("calculator", "ok"), tool("transfer_to_sales", "ok")] }));
    await storage.runs.save(baseRun(tg.id, { ...at("2026-09-21T10:00:00Z"), status: "error", durationMs: 3000, toolCalls: [tool("calculator", "error")] }));
    await storage.runs.save(baseRun(api.id, { ...at("2026-09-21T11:00:00Z"), status: "handoff", usage: { inputTokens: 50, outputTokens: 5 } }));
    await storage.runs.save(baseRun(api.id, { ...at("2026-09-21T12:00:00Z"), agent: "human", provider: "operator:karim" }));

    const s = await storage.runs.stats({ since: new Date("2026-09-20T00:00:00Z"), until: new Date("2026-09-21T23:00:00Z"), timezone: "UTC" });
    expect(s.totals).toMatchObject({ runs: 3, completed: 1, errors: 1, handoffs: 1, inputTokens: 150, outputTokens: 15, sessions: 2 });
    expect(s.daily.map((d) => [d.date, d.runs, d.errors])).toEqual([["2026-09-20", 1, 0], ["2026-09-21", 2, 1]]);
    expect(s.byChannel).toEqual([{ channel: "telegram", runs: 2 }, { channel: "api", runs: 1 }]);
    expect(s.topTools).toEqual([{ tool: "calculator", calls: 2, failures: 1 }]);
    expect(s.byAgent.map((a) => a.agent).sort()).toEqual(["banglaclaw", "sales"]);

    expect((await storage.sessions.list({ query: "8801712" })).map((x) => x.id)).toEqual([tg.id]);
    expect((await storage.sessions.list({ query: tg.id.slice(0, 8) })).map((x) => x.id)).toEqual([tg.id]);
    expect(await storage.sessions.list({ query: "100%_" })).toEqual([]);
  });

  it("runs the agent end-to-end with persistent history and checkpoints", async () => {
    const registry = new ToolRegistry();
    for (const tool of builtinTools) registry.register(tool);
    const provider = new FakeProvider([
      { toolCalls: [{ name: "calculator", args: { expression: "২৫ * ৪" } }] },
      { content: "১০০" },
      { content: "আবার জিজ্ঞেস করলেন!" },
    ]);
    const runtime = new AgentRuntime({
      provider,
      registry,
      policy: new AllowlistPolicy(["calculator"]),
      sessions: storage.sessions,
      runs: storage.runs,
      checkpointer: storage.checkpointer,
      limits: { maxIterations: 4, maxToolCalls: 4 },
      timeoutMs: 10_000,
      timezone: "Asia/Dhaka",
      logger: createLogger({ write: () => {} }),
    });
    const s = await storage.sessions.create({ channel: "cli", agentId: "banglaclaw" });

    const record = await runtime.run("২৫ * ৪ কত?", { sessionId: s.id });
    expect(record).toMatchObject({ status: "completed", output: "১০০" });
    expect(await storage.sessions.countMessages(s.id)).toBe(4);
    expect((await storage.runs.get(record.id))?.toolCalls[0]).toMatchObject({ tool: "calculator", status: "ok", output: { result: 100 } });
    expect(await runtime.checkpoint(record.id)).toMatchObject({ response: "১০০", toolCallCount: 1 });

    // While handed off, user messages are stored (run row first — messages.run_id is a foreign key).
    await storage.sessions.update(s.id, { status: "handoff", handoffReason: "test" });
    const waiting = await runtime.run("কেউ আছেন?", { sessionId: s.id });
    expect(waiting).toMatchObject({ status: "handoff", agent: "human" });
    expect(await storage.sessions.countMessages(s.id)).toBe(5);
    await storage.sessions.update(s.id, { status: "active" });

    // A new runtime instance (e.g. after restart) sees the persisted history.
    await runtime.run("আবার বলো", { sessionId: s.id });
    const history = provider.calls[2]?.messages.slice(1).map((m) => m.getType());
    expect(history).toEqual(["human", "ai", "tool", "ai", "human", "human"]);
  });
});

function baseRun(sessionId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: crypto.randomUUID(),
    sessionId,
    provider: "fake:scripted",
    promptVersion: "test",
    language: "bn",
    skills: [],
    agent: "banglaclaw",
    agentPath: ["banglaclaw"],
    input: "২+২?",
    status: "completed",
    iterations: 1,
    toolCalls: [],
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 5,
    ...overrides,
  };
}
