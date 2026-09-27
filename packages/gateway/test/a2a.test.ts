import { describe, expect, it } from "vitest";
import { createGatewayApp, type GatewayDeps } from "../src/index.js";
import { GatedProvider, makeDeps, parseSSE } from "./helpers.js";

type RpcResult = { jsonrpc: "2.0"; id: number | string | null; result?: Record<string, unknown>; error?: { code: number; message: string } };
type V1Task = {
  id: string;
  contextId: string;
  status: { state: string; message?: { parts: { text?: string }[] } };
  artifacts?: { parts: { text?: string }[] }[];
  metadata?: { sessionId?: string; runId?: string };
};

const rpc = (token: string | undefined, method: string, params: unknown, version: string | null = "1.0", id = 1): RequestInit => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token !== undefined && { Authorization: `Bearer ${token}` }),
    ...(version !== null && { "A2A-Version": version }),
  },
  body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
});
const message = (text: string, over: Record<string, unknown> = {}) => ({ message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }], ...over } });

async function a2aApp(options: Parameters<typeof makeDeps>[0] = {}, a2a: GatewayDeps["a2a"] = {}) {
  const made = await makeDeps(options);
  return { ...made, app: createGatewayApp({ ...made.deps, a2a }) };
}
async function send(app: ReturnType<typeof createGatewayApp>, token: string, text: string, over: Record<string, unknown> = {}): Promise<V1Task> {
  const res = await app.request("/a2a", rpc(token, "SendMessage", message(text, over)));
  expect(res.status).toBe(200);
  const body = (await res.json()) as RpcResult;
  expect(body.error).toBeUndefined();
  return body.result?.task as V1Task;
}

describe("A2A agent card", () => {
  it("is public and describes the JSON-RPC endpoint, bearer auth and skills", async () => {
    const { app } = await a2aApp({}, { publicUrl: "https://bot.example.com", description: "Dokan helper" });
    const res = await app.request("/.well-known/agent-card.json", { headers: { "A2A-Version": "1.0" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("vary")).toBe("A2A-Version");
    const card = (await res.json()) as Record<string, unknown>;
    expect(card).toMatchObject({
      name: "banglaclaw",
      description: "Dokan helper",
      version: "test",
      supportedInterfaces: [
        { url: "https://bot.example.com/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
        { url: "https://bot.example.com/a2a", protocolBinding: "JSONRPC", protocolVersion: "0.3" },
      ],
      capabilities: { streaming: true, pushNotifications: false },
      securitySchemes: { banglaclawApiKey: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
    });
    expect((card.skills as { id: string }[]).map((s) => s.id)).toEqual(["chat", "calculation"]);

    const etag = res.headers.get("etag") ?? "";
    expect((await app.request("/.well-known/agent-card.json", { headers: { "A2A-Version": "1.0", "If-None-Match": etag } })).status).toBe(304);
  });

  it("serves a v0.3 card to clients that send no version, with the request origin when publicUrl is unset", async () => {
    const { app } = await a2aApp();
    const card = (await (await app.request("http://agents.local:3000/.well-known/agent-card.json")).json()) as Record<string, unknown>;
    expect(card).toMatchObject({
      protocolVersion: "0.3.0",
      url: "http://agents.local:3000/a2a",
      preferredTransport: "JSONRPC",
      securitySchemes: { banglaclawApiKey: { type: "http", scheme: "bearer" } },
      security: [{ banglaclawApiKey: [] }],
    });
  });

  it("is not served unless enabled", async () => {
    const { deps, alice } = await makeDeps();
    const app = createGatewayApp(deps);
    expect((await app.request("/.well-known/agent-card.json")).status).toBe(404);
    expect((await app.request("/a2a", rpc(alice, "SendMessage", message("hi")))).status).toBe(404);
  });
});

describe("A2A JSON-RPC", () => {
  it("needs an API key with the run scope", async () => {
    const { app, deps } = await a2aApp();
    const res = await app.request("/a2a", rpc(undefined, "SendMessage", message("hi")));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    const readOnly = await deps.auth.issueKey("reader", "read-only", "user", ["read"]);
    expect((await app.request("/a2a", rpc(readOnly.token, "SendMessage", message("hi")))).status).toBe(403);
  });

  it("runs the agent and returns a completed task with the reply as an artifact", async () => {
    const { app, alice, deps } = await a2aApp({ script: [{ content: "আমি ভালো আছি" }] });
    const task = await send(app, alice, "কেমন আছো?");
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task.artifacts?.[0]?.parts[0]?.text).toBe("আমি ভালো আছি");
    const session = await deps.sessions.get(task.metadata?.sessionId ?? "");
    expect(session).toMatchObject({ channel: "a2a", externalId: `${session?.userId}/${task.contextId}` });
    expect((await deps.runs.get(task.metadata?.runId ?? ""))?.output).toBe("আমি ভালো আছি");
  });

  it("keeps one session per contextId and per user", async () => {
    const { app, alice, bob } = await a2aApp({ script: [{ content: "one" }, { content: "two" }, { content: "three" }] });
    const first = await send(app, alice, "hello", { contextId: "shop-42" });
    const second = await send(app, alice, "again", { contextId: "shop-42" });
    expect(second.metadata?.sessionId).toBe(first.metadata?.sessionId);
    const other = await send(app, bob, "hello", { contextId: "shop-42" });
    expect(other.metadata?.sessionId).not.toBe(first.metadata?.sessionId);
  });

  it("scopes tasks to the user who created them", async () => {
    const { app, alice, bob } = await a2aApp();
    const task = await send(app, alice, "hi");
    const mine = (await (await app.request("/a2a", rpc(alice, "GetTask", { id: task.id }))).json()) as RpcResult;
    expect(mine.result).toMatchObject({ id: task.id, status: { state: "TASK_STATE_COMPLETED" } });
    const theirs = (await (await app.request("/a2a", rpc(bob, "GetTask", { id: task.id }))).json()) as RpcResult;
    expect(theirs.error?.code).toBe(-32001);
  });

  it("streams the task, working status, artifact and final status as SSE", async () => {
    const { app, alice } = await a2aApp({ script: [{ content: "streamed" }] });
    const res = await app.request("/a2a", rpc(alice, "SendStreamingMessage", message("hi")));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSSE(await res.text()).map((e) => (e.data as RpcResult).result ?? {});
    expect(events.map((e) => Object.keys(e)[0])).toEqual(["task", "statusUpdate", "artifactUpdate", "statusUpdate"]);
    expect(events[1]).toMatchObject({ statusUpdate: { status: { state: "TASK_STATE_WORKING" } } });
    expect(events[2]).toMatchObject({ artifactUpdate: { artifact: { parts: [{ text: "streamed" }] }, lastChunk: true } });
    expect(events[3]).toMatchObject({ statusUpdate: { status: { state: "TASK_STATE_COMPLETED" } } });
  });

  it("cancels a running task", async () => {
    const provider = new GatedProvider();
    const { app, alice } = await a2aApp({ provider });
    const res = await app.request("/a2a", rpc(alice, "SendMessage", { ...message("slow"), configuration: { returnImmediately: true } }));
    const task = ((await res.json()) as RpcResult).result?.task as V1Task;
    await provider.started;
    const canceled = (await (await app.request("/a2a", rpc(alice, "CancelTask", { id: task.id }))).json()) as RpcResult;
    expect(canceled.result).toMatchObject({ id: task.id, status: { state: "TASK_STATE_CANCELED" } });
  });

  it("reports a run timeout as failed, not canceled", async () => {
    const provider = new GatedProvider();
    const made = await makeDeps({ provider });
    const { AgentRuntime } = await import("@entrogic-net/agent");
    const { deps } = made;
    const runtime = new AgentRuntime({ provider, registry: deps.registry, policy: deps.policy, sessions: deps.sessions, runs: deps.runs, skills: deps.skills, limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 50, timezone: "Asia/Dhaka" });
    const app = createGatewayApp({ ...deps, runtime, a2a: {} });
    const task = await send(app, made.alice, "slow");
    expect(task.status).toMatchObject({ state: "TASK_STATE_FAILED", message: { parts: [{ text: expect.stringContaining("timed out") }] } });
  });

  it("counts runs against the key's concurrency limit", async () => {
    const provider = new GatedProvider();
    const { app, alice } = await a2aApp({ provider, config: { rateLimit: { requestsPerMinute: 100, maxConcurrentRuns: 1 } } });
    const first = app.request("/a2a", rpc(alice, "SendMessage", message("slow")));
    await provider.started;
    const busy = await send(app, alice, "again");
    expect(busy.status.state).toBe("TASK_STATE_FAILED");
    expect(busy.status.message?.parts[0]?.text).toContain("At most 1 runs");
    provider.release();
    const done = ((await (await first).json()) as RpcResult).result?.task as V1Task;
    expect(done.status.state).toBe("TASK_STATE_COMPLETED");
  });

  it("rejects files and over-long messages, and reports handoff as input-required", async () => {
    const { app, alice, deps } = await a2aApp({ script: [{ content: "ok" }] });
    const file = await send(app, alice, "", { parts: [{ url: "https://example.com/a.pdf", mediaType: "application/pdf" }] });
    expect(file.status).toMatchObject({ state: "TASK_STATE_REJECTED", message: { parts: [{ text: expect.stringContaining("files are not accepted") }] } });
    const long = await send(app, alice, "x".repeat(101));
    expect(long.status.state).toBe("TASK_STATE_REJECTED");

    const first = await send(app, alice, "hello", { contextId: "desk" });
    await deps.sessions.update(first.metadata?.sessionId ?? "", { status: "handoff", handoffReason: "refund" });
    const waiting = await send(app, alice, "are you there?", { contextId: "desk" });
    expect(waiting.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
  });

  it("speaks A2A v0.3 to clients that send no version header", async () => {
    const { app, alice } = await a2aApp({ script: [{ content: "legacy ok" }] });
    const res = await app.request(
      "/a2a",
      rpc(alice, "message/send", { message: { kind: "message", messageId: "m1", role: "user", parts: [{ kind: "text", text: "hi" }] } }, null),
    );
    expect(await res.json()).toMatchObject({
      result: { kind: "task", status: { state: "completed" }, artifacts: [{ parts: [{ kind: "text", text: "legacy ok" }] }] },
    });
  });

  it("answers malformed requests with JSON-RPC errors", async () => {
    const { app, alice } = await a2aApp();
    const headers = { Authorization: `Bearer ${alice}`, "A2A-Version": "1.0" };
    const parse = (await (await app.request("/a2a", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{" })).json()) as RpcResult;
    expect(parse.error?.code).toBe(-32700);
    const type = (await (await app.request("/a2a", { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: "{}" })).json()) as RpcResult;
    expect(type.error?.code).toBe(-32005);
    const unknown = (await (await app.request("/a2a", rpc(alice, "NoSuchMethod", {}, "1.0", 7))).json()) as RpcResult;
    expect(unknown).toMatchObject({ id: 7, error: { code: -32601 } });
    const version = (await (await app.request("/a2a", rpc(alice, "SendMessage", message("hi"), "9.0"))).json()) as RpcResult;
    expect(version.error?.code).toBe(-32009);
  });
});
