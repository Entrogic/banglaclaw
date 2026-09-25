import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@banglaclaw/agent";
import { ApiKeyAuthenticator, InMemoryAuthStore } from "@banglaclaw/auth";
import { createGatewayApp } from "@banglaclaw/gateway";
import { FakeProvider } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@banglaclaw/session";
import { createLogger } from "@banglaclaw/shared";
import { SkillSet } from "@banglaclaw/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@banglaclaw/tools";
import { BanglaClawApiError, BanglaClawClient, parseSSE, type StreamEvent } from "../src/index.js";

async function setup() {
  const silent = createLogger({ write: () => {} });
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore();
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
  const app = createGatewayApp({
    runtime, sessions, runs, auth, registry, policy, skills: new SkillSet([]), agent: { name: "banglaclaw", model: provider.id },
    config: { host: "127.0.0.1", port: 0, corsOrigins: [], maxInputChars: 1000, trustProxy: false, metrics: true, rateLimit: { requestsPerMinute: 1000, maxConcurrentRuns: 2 } },
    version: "1.0.0", logger: silent,
  });
  const fetchViaApp = async (url: string, init?: RequestInit) => app.request(url.replace("http://gateway.test", ""), init);
  return { client: new BanglaClawClient({ baseUrl: "http://gateway.test/", apiKey: token, fetch: fetchViaApp }), fetchViaApp };
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
});
