import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@entrogic-net/agent";
import { ApiKeyAuthenticator, InMemoryAuthStore } from "@entrogic-net/auth";
import { createGatewayApp } from "@entrogic-net/gateway";
import { FakeProvider } from "@entrogic-net/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@entrogic-net/session";
import { createLogger } from "@entrogic-net/shared";
import { SkillSet } from "@entrogic-net/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@entrogic-net/tools";
import { BanglaClawApiError, BanglaClawClient, parseSSE, type StreamEvent } from "../src/index.js";

async function setup() {
  const silent = createLogger({ write: () => {} });
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore(sessions);
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  const policy = new AllowlistPolicy(["calculator"]);
  const provider = new FakeProvider([
    { toolCalls: [{ name: "calculator", args: { expression: "6*7" } }] },
    { content: "It is 42", usage: { input: 50, output: 5 } },
    { content: "Second reply" },
  ]);
  const runtime = new AgentRuntime({ provider, registry, policy, sessions, runs, limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent });
  const auth = new ApiKeyAuthenticator(new InMemoryAuthStore());
  const { token } = await auth.issueKey("sdk-user");
  const { token: adminToken } = await auth.issueKey("sdk-admin", "admin", "admin");
  const app = createGatewayApp({
    runtime, sessions, runs, auth, registry, policy, skills: new SkillSet([]), agent: { name: "banglaclaw", model: provider.id },
    config: { host: "127.0.0.1", port: 0, corsOrigins: [], maxInputChars: 1000, trustProxy: false, metrics: true, rateLimit: { requestsPerMinute: 1000, maxConcurrentRuns: 2 } },
    version: "1.0.0", logger: silent,
  });
  const fetchViaApp = async (url: string, init?: RequestInit) => app.request(url.replace("http://gateway.test", ""), init);
  return {
    client: new BanglaClawClient({ baseUrl: "http://gateway.test/", apiKey: token, fetch: fetchViaApp }),
    admin: new BanglaClawClient({ baseUrl: "http://gateway.test", apiKey: adminToken, fetch: fetchViaApp }),
    fetchViaApp,
    sessions,
  };
}

describe("BanglaClawClient", () => {
  it("covers health, me, streaming runs, sessions and runs", async () => {
    const { client } = await setup();
    expect(await client.health()).toEqual({ status: "ok", version: "1.0.0" });
    expect((await client.me()).user.name).toBe("sdk-user");

    const events: StreamEvent[] = [];
    for await (const e of client.stream("what is 6*7?")) events.push(e);
    expect(events.map((e) => e.event)).toEqual(["session", "run_start", "tool_start", "tool_end", "token", "token", "token", "final", "done"]);
    const done = events.at(-1);
    if (done?.event !== "done") throw new Error("no done event");
    expect(done.data.run).toMatchObject({ status: "completed", output: "It is 42", usage: { inputTokens: 50, outputTokens: 5 } });

    const sessionId = done.data.sessionId;
    const second = await client.sessions.send(sessionId, "again");
    expect(second.reply).toBe("Second reply");
    expect((await client.sessions.messages(sessionId)).messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user", "assistant"]);
    expect((await client.sessions.list()).sessions[0]?.id).toBe(sessionId);
    const { runs } = await client.sessions.runs(sessionId);
    expect((await client.runs.get(runs[0]?.id ?? "")).run.id).toBe(runs[0]?.id);
  });

  it("covers the admin API", async () => {
    const { client, admin } = await setup();
    await client.run("hello");
    const stats = await admin.admin.stats({ days: 2 });
    expect(stats.totals.runs).toBe(1);
    expect(stats.daily).toHaveLength(2);
    const { sessions } = await admin.admin.sessions();
    expect(sessions[0]).toMatchObject({ userName: "sdk-user", messageCount: 4 });
    expect((await admin.admin.session(sessions[0]?.id ?? "")).runs).toHaveLength(1);
    const { key, token } = await admin.admin.createKey({ user: "bot", scopes: ["read"] });
    expect(token).toMatch(/^bck_/);
    expect((await admin.admin.keys()).keys.map((k) => k.id)).toContain(key.id);
    expect(await admin.admin.revokeKey(key.id)).toEqual({ revoked: key.id });
    await expect(client.admin.stats()).rejects.toMatchObject({ status: 403 });
  });

  it("renames, searches and deletes sessions, and reports features", async () => {
    const { client } = await setup();
    const { sessionId } = await client.run("৬ গুণ ৭");
    expect((await client.sessions.rename(sessionId, "গুণের প্রশ্ন")).session.title).toBe("গুণের প্রশ্ন");
    expect((await client.sessions.list({ q: "গুণের" })).sessions.map((s) => s.id)).toEqual([sessionId]);
    await client.sessions.delete(sessionId);
    expect((await client.sessions.list()).sessions).toEqual([]);
    expect(await client.features()).toEqual({ workspace: false, uploads: null, transcription: false });
    await expect(client.workspace.list()).rejects.toMatchObject({ status: 404, code: "workspace_disabled" });
    await expect(client.transcribe(new Uint8Array(3), "audio/webm")).rejects.toMatchObject({ status: 404, code: "transcription_disabled" });
  });

  it("raises typed API errors", async () => {
    const { client } = await setup();
    const error = await client.sessions.get("00000000-0000-4000-8000-000000000000").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BanglaClawApiError);
    expect(error).toMatchObject({ status: 404, code: "session_not_found" });
    expect((error as BanglaClawApiError).requestId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(client.knowledge.search("x")).rejects.toMatchObject({ status: 404, code: "knowledge_disabled" });
    await expect(client.handoffs.list()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("parses SSE split across chunks", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const part of ["event: token\ndata: {\"te", "xt\":\"a\"}\n\nevent: done\r\n", "data: {}\r\n\r\n"]) c.enqueue(enc.encode(part));
        c.close();
      },
    });
    const out: { event: string; data: string }[] = [];
    for await (const e of parseSSE(body)) out.push(e);
    expect(out).toEqual([{ event: "token", data: '{"text":"a"}' }, { event: "done", data: "{}" }]);
  });

  it("follows a session's operator replies with sessions.events()", async () => {
    const { client, admin, sessions } = await setup();
    const { session } = await client.sessions.create();
    await sessions.update(session.id, { status: "handoff" });
    const controller = new AbortController();
    const events = client.sessions.events(session.id, { signal: controller.signal });
    const first = events.next();
    // The subscription is live once the stream has opened; retry the reply until it is pushed.
    await expect.poll(async () => (await admin.handoffs.reply(session.id, "Hello from ops")).delivered).toBe(true);
    expect((await first).value).toMatchObject({ type: "operator_message", sessionId: session.id, text: "Hello from ops" });
    controller.abort();
    expect((await events.next()).done).toBe(true);
    await expect(async () => {
      for await (const _ of admin.sessions.events(session.id)) break;
    }).rejects.toMatchObject({ status: 404, code: "session_not_found" });
  });
});

