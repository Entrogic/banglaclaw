import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createGatewayApp } from "../src/index.js";
import { GatedProvider, makeDeps, parseSSE } from "./helpers.js";

const json = (token: string, body: unknown, extra: Record<string, string> = {}) => ({
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra },
  body: JSON.stringify(body),
});
const get = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("gateway REST", () => {
  it("serves health without auth and echoes request ids", async () => {
    const { deps } = await makeDeps();
    const app = createGatewayApp(deps);
    const res = await app.request("/health", { headers: { "X-Request-Id": "req-123" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "test" });
    expect(res.headers.get("x-request-id")).toBe("req-123");
    expect((await app.request("/health", { headers: { "X-Request-Id": "bad id!" } })).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects missing and invalid API keys", async () => {
    const { deps } = await makeDeps();
    const app = createGatewayApp(deps);
    const missing = await app.request("/v1/me");
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    const body = (await missing.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("unauthenticated");
    expect(body.error.requestId).toBe(missing.headers.get("x-request-id"));
    expect((await app.request("/v1/me", get("bck_000000000000_" + "a".repeat(40)))).status).toBe(401);
  });

  it("runs the agent and continues the session", async () => {
    const { deps, alice } = await makeDeps({ script: [{ content: "first" }, { content: "second" }] });
    const app = createGatewayApp(deps);
    expect(await (await app.request("/v1/me", get(alice))).json()).toMatchObject({ user: { name: "alice" } });

    const res = await app.request("/v1/agents/run", json(alice, { text: "hi" }));
    expect(res.status).toBe(200);
    const first = (await res.json()) as { sessionId: string; sessionCreated: boolean; reply: string; run: { status: string } };
    expect(first).toMatchObject({ sessionCreated: true, reply: "first", run: { status: "completed" } });
    expect(res.headers.get("x-session-id")).toBe(first.sessionId);

    const second = await app.request(`/v1/sessions/${first.sessionId}/messages`, json(alice, { text: "again" }));
    expect(await second.json()).toMatchObject({ sessionId: first.sessionId, reply: "second" });

    const messages = (await (await app.request(`/v1/sessions/${first.sessionId}/messages`, get(alice))).json()) as { messages: { role: string; content: string }[] };
    expect(messages.messages.map((m) => [m.role, m.content])).toEqual([["user", "hi"], ["assistant", "first"], ["user", "again"], ["assistant", "second"]]);

    const runs = (await (await app.request(`/v1/sessions/${first.sessionId}/runs`, get(alice))).json()) as { runs: { id: string }[] };
    expect(runs.runs).toHaveLength(2);
    expect((await app.request(`/v1/runs/${runs.runs[0]?.id}`, get(alice))).status).toBe(200);
    expect(await (await app.request("/v1/sessions", get(alice))).json()).toMatchObject({ sessions: [{ id: first.sessionId, channel: "api" }] });
  });

  it("reuses sessions by externalId, scoped per user", async () => {
    const { deps, alice, bob } = await makeDeps();
    const app = createGatewayApp(deps);
    const a1 = (await (await app.request("/v1/sessions", json(alice, { externalId: "chat-1" }))).json()) as { session: { id: string; externalId: string }; created: boolean };
    expect(a1).toMatchObject({ created: true, session: { externalId: "chat-1" } });
    const a2 = (await (await app.request("/v1/agents/run", json(alice, { text: "hi", externalId: "chat-1" }))).json()) as { sessionId: string; sessionCreated: boolean };
    expect(a2).toMatchObject({ sessionId: a1.session.id, sessionCreated: false });
    const b1 = (await (await app.request("/v1/sessions", json(bob, { externalId: "chat-1" }))).json()) as { session: { id: string }; created: boolean };
    expect(b1.created).toBe(true);
    expect(b1.session.id).not.toBe(a1.session.id);
  });

  it("isolates sessions and runs between users", async () => {
    const { deps, alice, bob } = await makeDeps();
    const app = createGatewayApp(deps);
    const { sessionId, run } = (await (await app.request("/v1/agents/run", json(alice, { text: "secret" }))).json()) as { sessionId: string; run: { id: string } };
    for (const path of [`/v1/sessions/${sessionId}`, `/v1/sessions/${sessionId}/messages`, `/v1/sessions/${sessionId}/runs`, `/v1/runs/${run.id}`]) {
      const res = await app.request(path, get(bob));
      expect(res.status, path).toBe(404);
    }
    expect((await app.request(`/v1/sessions/${sessionId}/messages`, json(bob, { text: "x" }))).status).toBe(404);
    expect((await app.request("/v1/agents/run", json(bob, { text: "x", sessionId }))).status).toBe(404);
    expect(await (await app.request("/v1/sessions", get(bob))).json()).toEqual({ sessions: [] });
  });

  it("validates requests", async () => {
    const { deps, alice } = await makeDeps();
    const app = createGatewayApp(deps);
    const cases: [unknown, number][] = [
      [{ text: "" }, 400],
      [{ text: "x".repeat(101) }, 400],
      [{ text: "hi", extra: 1 }, 400],
      [{ text: "hi", sessionId: "not-a-uuid" }, 400],
    ];
    for (const [body, status] of cases) expect((await app.request("/v1/agents/run", json(alice, body))).status).toBe(status);
    const bad = await app.request("/v1/agents/run", { method: "POST", headers: { Authorization: `Bearer ${alice}` }, body: "{nope" });
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_json" } });
    expect((await app.request("/v1/nope", get(alice))).status).toBe(404);
  });

  it("streams run events over SSE", async () => {
    const { deps, alice } = await makeDeps({ script: [{ toolCalls: [{ name: "calculator", args: { expression: "6*7" } }] }, { content: "It is 42" }] });
    const app = createGatewayApp(deps);
    const res = await app.request("/v1/agents/run?stream=true", json(alice, { text: "calculate 6*7" }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSSE(await res.text());
    expect(events.map((e) => e.event)).toEqual(["session", "run_start", "tool_start", "tool_end", "token", "token", "token", "final", "done"]);
    expect(events[1]?.data).toMatchObject({ skills: ["calculation"] });
    expect(events.at(-1)?.data).toMatchObject({ run: { status: "completed", output: "It is 42", toolCalls: [{ tool: "calculator", status: "ok" }] } });
  });

  it("maps provider failures to 502 and emits an SSE error", async () => {
    const failing = { id: "broken", chat: () => Promise.reject(new Error("x")), stream: async function* () { throw new Error("upstream down"); } };
    const { deps, alice } = await makeDeps({ provider: failing });
    const app = createGatewayApp(deps);
    const res = await app.request("/v1/agents/run", json(alice, { text: "hi" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "run_failed" } });
    const events = parseSSE(await (await app.request("/v1/agents/run", json(alice, { text: "hi" }, { Accept: "text/event-stream" }))).text());
    expect(events.map((e) => e.event)).toEqual(["session", "run_start", "error", "done"]);
    expect(events.at(-1)?.data).toMatchObject({ run: { status: "error" } });
  });

  it("rate limits per API key", async () => {
    const { deps, alice, bob } = await makeDeps({ config: { rateLimit: { requestsPerMinute: 2, maxConcurrentRuns: 2 } } });
    const app = createGatewayApp(deps);
    expect((await app.request("/v1/me", get(alice))).status).toBe(200);
    expect((await app.request("/v1/me", get(alice))).status).toBe(200);
    const limited = await app.request("/v1/me", get(alice));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await app.request("/v1/me", get(bob))).status).toBe(200);
  });

  it("caps concurrent runs per API key", async () => {
    const provider = new GatedProvider();
    const { deps, alice, bob } = await makeDeps({ provider, config: { rateLimit: { requestsPerMinute: 100, maxConcurrentRuns: 1 } } });
    const app = createGatewayApp(deps);
    const first = app.request("/v1/agents/run", json(alice, { text: "slow" }));
    await provider.started;
    const second = await app.request("/v1/agents/run", json(alice, { text: "again" }));
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ error: { code: "too_many_concurrent_runs" } });
    provider.release();
    expect((await first).status).toBe(200);
    expect(bob).toBeDefined();
  });

  it("lists agents, tools and skills", async () => {
    const { deps, alice } = await makeDeps();
    const app = createGatewayApp(deps);
    expect(await (await app.request("/v1/agents", get(alice))).json()).toMatchObject({ agents: [{ id: "banglaclaw", tools: ["calculator"], skills: ["calculation"] }] });
    const tools = (await (await app.request("/v1/tools", get(alice))).json()) as { tools: { name: string; allowed: boolean }[] };
    expect(tools.tools.map((t) => [t.name, t.allowed])).toEqual([["calculator", true], ["current_datetime", false]]);
    expect(await (await app.request("/v1/skills", get(alice))).json()).toMatchObject({ skills: [{ name: "calculation", tools: ["calculator"] }] });
  });
});

describe("gateway extras", () => {
  it("serves the web chat page with a strict CSP only when enabled", async () => {
    const { deps } = await makeDeps();
    expect((await createGatewayApp(deps).request("/chat")).status).toBe(404);
    const res = await createGatewayApp({ ...deps, webChat: true }).request("/chat");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).toContain("/v1/ws");
  });

  it("mounts extra routes outside /v1 auth", async () => {
    const { deps } = await makeDeps();
    const hook = new Hono().post("/channels/test/webhook", (c) => c.text("hooked"));
    const res = await createGatewayApp({ ...deps, routes: [hook] }).request("/channels/test/webhook", { method: "POST" });
    expect(await res.text()).toBe("hooked");
  });
});

describe("gateway knowledge and memory", () => {
  it("searches the knowledge base and manages the caller's memories", async () => {
    const { HashEmbedder, InMemoryVectorStore, KnowledgeBase, LongTermMemory, ownerForUser } = await import("@banglaclaw/knowledge");
    const { deps, alice, bob } = await makeDeps();
    const kb = new KnowledgeBase({ store: new InMemoryVectorStore(), embedder: new HashEmbedder(), collection: "kb", chunkSize: 500, chunkOverlap: 0 });
    await kb.ingestText({ source: "faq.md", text: "Delivery inside Dhaka costs 60 taka." });
    const memory = new LongTermMemory({ store: new InMemoryVectorStore(), embedder: new HashEmbedder(), collection: "mem", maxPerOwner: 10 });
    const app = createGatewayApp({ ...deps, knowledge: { kb, searchLimit: 3, minScore: 0 }, memory });

    const search = (await (await app.request("/v1/knowledge/search?q=delivery%20Dhaka", get(alice))).json()) as { results: { source: string }[] };
    expect(search.results[0]?.source).toBe("faq.md");
    expect((await app.request("/v1/knowledge/search", get(alice))).status).toBe(400);
    expect(await (await app.request("/v1/knowledge/documents", get(alice))).json()).toMatchObject({ documents: [{ source: "faq.md" }] });

    const me = (await (await app.request("/v1/me", get(alice))).json()) as { user: { id: string } };
    const { memory: m } = await memory.remember(ownerForUser(me.user.id), "Alice prefers Bangla replies");
    expect(await (await app.request("/v1/memories", get(alice))).json()).toMatchObject({ memories: [{ id: m.id, text: "Alice prefers Bangla replies" }] });
    expect(await (await app.request("/v1/memories", get(bob))).json()).toEqual({ memories: [] });
    expect((await app.request(`/v1/memories/${m.id}`, { method: "DELETE", ...get(bob) })).status).toBe(404);
    expect((await app.request(`/v1/memories/${m.id}`, { method: "DELETE", ...get(alice) })).status).toBe(204);
    expect((await createGatewayApp(deps).request("/v1/memories", get(alice))).status).toBe(404);
  });
});

describe("gateway human handoff", () => {
  it("lets operators list, read, reply to and release handed-off sessions", async () => {
    const { deps, alice } = await makeDeps({ script: [{ content: "bot reply" }] });
    const ops = (await deps.auth.issueKey("ops", "console", "operator")).token;
    const pushed: [string, string][] = [];
    const app = createGatewayApp({ ...deps, deliver: async (s, text) => { pushed.push([s.id, text]); return true; } });

    const { sessionId } = (await (await app.request("/v1/agents/run", json(alice, { text: "hi" }))).json()) as { sessionId: string };
    await deps.sessions.update(sessionId, { status: "handoff", handoffReason: "wants a refund" });

    expect((await app.request("/v1/handoffs", get(alice))).status).toBe(403);
    const queue = (await (await app.request("/v1/handoffs", get(ops))).json()) as { handoffs: { id: string; status: string; handoffReason: string }[] };
    expect(queue.handoffs).toEqual([expect.objectContaining({ id: sessionId, status: "handoff", handoffReason: "wants a refund" })]);

    // While handed off the user's message is stored and the bot stays silent.
    const waiting = (await (await app.request(`/v1/sessions/${sessionId}/messages`, json(alice, { text: "hello?" }))).json()) as { reply: string; run: { status: string; agent: string } };
    expect(waiting).toMatchObject({ reply: "", run: { status: "handoff", agent: "human" } });

    const reply = await app.request(`/v1/handoffs/${sessionId}/reply`, json(ops, { text: "Hi, I'm Karim from support." }));
    expect(await reply.json()).toMatchObject({ delivered: true });
    expect(pushed).toEqual([[sessionId, "Hi, I'm Karim from support."]]);
    const detail = (await (await app.request(`/v1/handoffs/${sessionId}`, get(ops))).json()) as { messages: { role: string; content: string }[] };
    expect(detail.messages.at(-1)).toEqual({ role: "operator", content: "Hi, I'm Karim from support." });

    expect(await (await app.request(`/v1/handoffs/${sessionId}/release`, json(ops, {}))).json()).toMatchObject({ session: { status: "active" } });
    expect((await app.request(`/v1/handoffs/${sessionId}/release`, json(ops, {}))).status).toBe(409);
    expect((await app.request(`/v1/handoffs/00000000-0000-4000-8000-000000000000`, get(ops))).status).toBe(404);
    expect(await (await app.request("/v1/me", get(ops))).json()).toMatchObject({ user: { role: "operator" } });
  });
});

describe("gateway security", () => {
  it("enforces key scopes, admin-only audit and records security events", async () => {
    const { InMemoryAuditStore } = await import("@banglaclaw/shared");
    const { deps, alice } = await makeDeps();
    const audit = new InMemoryAuditStore();
    const app = createGatewayApp({ ...deps, audit, config: { ...deps.config, trustProxy: true } });
    const reader = (await deps.auth.issueKey("reader", "ro", undefined, ["read"])).token;
    const admin = (await deps.auth.issueKey("root", "admin", "admin")).token;

    const me = await app.request("/v1/me", get(reader));
    expect(me.status).toBe(200);
    expect(me.headers.get("x-content-type-options")).toBe("nosniff");
    expect(me.headers.get("cache-control")).toBe("no-store");
    expect(await me.json()).toMatchObject({ key: { scopes: ["read"] } });
    const run = await app.request("/v1/agents/run", json(reader, { text: "hi" }));
    expect(run.status).toBe(403);
    expect(await run.json()).toMatchObject({ error: { code: "insufficient_scope" } });

    await app.request("/v1/me", { headers: { Authorization: "Bearer bck_000000000000_" + "a".repeat(40), "X-Forwarded-For": "203.0.113.7, 10.0.0.1" } });
    expect((await app.request("/v1/audit", get(alice))).status).toBe(403);
    // Admins pass operator checks too.
    expect((await app.request("/v1/handoffs", get(admin))).status).toBe(200);

    const events = (await (await app.request("/v1/audit", get(admin))).json()) as { events: { action: string; ip?: string; metadata?: Record<string, unknown> }[] };
    const actions = events.events.map((e) => e.action);
    expect(actions).toContain("auth.failed");
    expect(actions).toContain("auth.forbidden");
    expect(events.events.find((e) => e.action === "auth.failed")?.ip).toBe("203.0.113.7");
    expect(events.events.find((e) => e.metadata?.missingScope === "run")).toBeDefined();
    const filtered = (await (await app.request("/v1/audit?action=auth.failed", get(admin))).json()) as { events: unknown[] };
    expect(filtered.events).toHaveLength(1);
  });

  it("throttles audit writes for repeated failed logins", async () => {
    const { InMemoryAuditStore } = await import("@banglaclaw/shared");
    const { deps } = await makeDeps();
    const audit = new InMemoryAuditStore();
    const app = createGatewayApp({ ...deps, audit });
    for (let i = 0; i < 30; i++) await app.request("/v1/me");
    expect((await audit.list({ action: "auth.failed" })).length).toBeLessThanOrEqual(10);
  });
});

describe("gateway metrics", () => {
  it("serves Prometheus metrics with route labels and an optional token", async () => {
    const { Metrics } = await import("@banglaclaw/observability");
    const { deps, alice } = await makeDeps();
    const metrics = Object.assign(new Metrics({ defaultMetrics: false }), { token: "scrape-secret" });
    const app = createGatewayApp({ ...deps, metrics });
    await app.request("/v1/agents/run", json(alice, { text: "hi" }));
    const s = (await (await app.request("/v1/sessions", get(alice))).json()) as { sessions: { id: string }[] };
    await app.request(`/v1/sessions/${s.sessions[0]?.id}`, get(alice));

    expect((await app.request("/metrics")).status).toBe(401);
    const res = await app.request("/metrics", { headers: { Authorization: "Bearer scrape-secret" } });
    const text = await res.text();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain('banglaclaw_http_requests_total{method="POST",route="/v1/agents/run",status="200"} 1');
    expect(text).toContain('route="/v1/sessions/:id"');
    expect(text).not.toContain(s.sessions[0]?.id ?? "none");
  });
});

describe("OpenAPI", () => {
  it("documents every registered route", async () => {
    const { Metrics } = await import("@banglaclaw/observability");
    const { deps } = await makeDeps();
    const upgrade = (() => () => new Response()) as never;
    const app = createGatewayApp({ ...deps, metrics: new Metrics({ defaultMetrics: false }), dashboardDir: "/nonexistent" }, upgrade);
    const res = await app.request("/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(spec.openapi).toBe("3.1.0");

    const registered = new Set(
      app.routes
        .filter((r) => r.method !== "ALL" && r.path !== "/*" && !r.path.startsWith("/channels") && r.path !== "/chat" && r.path !== "/admin" && !r.path.endsWith("/*"))
        .map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
    );
    const documented = new Set(Object.entries(spec.paths).filter(([path]) => path !== "/admin/{path}").flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m} ${path}`)));
    expect([...registered].filter((r) => !documented.has(r))).toEqual([]);
    expect([...documented].filter((d) => !registered.has(d))).toEqual([]);
  });
});

describe("admin API and dashboard", () => {
  it("serves analytics with cost estimates, all-user sessions and key management to admins only", async () => {
    const { InMemoryAuditStore } = await import("@banglaclaw/shared");
    const { deps, alice, bob } = await makeDeps({ script: [{ content: "hi", usage: { input: 1_000_000, output: 500_000 } }] });
    const audit = new InMemoryAuditStore();
    const app = createGatewayApp({ ...deps, audit, pricing: { "fake:scripted": { input: 0.15, output: 0.6 } }, timezone: "Asia/Dhaka" });
    const admin = (await deps.auth.issueKey("root", "console", "admin")).token;
    const ops = (await deps.auth.issueKey("ops", "console", "operator")).token;

    const { sessionId } = (await (await app.request("/v1/agents/run", json(alice, { text: "hello" }))).json()) as { sessionId: string };
    await app.request("/v1/sessions", json(bob, { externalId: "8801712345678" }));

    for (const token of [alice, ops]) expect((await app.request("/v1/admin/stats", get(token))).status).toBe(403);

    const stats = (await (await app.request("/v1/admin/stats?days=3", get(admin))).json()) as { days: number; timezone: string; totals: { runs: number; inputTokens: number }; daily: unknown[]; byProvider: { costUsd?: number }[]; totalCostUsd: number; byChannel: { channel: string }[] };
    expect(stats).toMatchObject({ days: 3, timezone: "Asia/Dhaka", totals: { runs: 1, inputTokens: 1_000_000 } });
    expect(stats.daily).toHaveLength(3);
    expect(stats.byProvider[0]?.costUsd).toBe(0.45);
    expect(stats.totalCostUsd).toBe(0.45);
    expect(stats.byChannel).toEqual([{ channel: "api", runs: 1 }]);

    const all = (await (await app.request("/v1/admin/sessions", get(admin))).json()) as { sessions: { id: string; userName?: string; messageCount: number }[] };
    expect(all.sessions.map((s) => s.userName).sort()).toEqual(["alice", "bob"]);
    const found = (await (await app.request("/v1/admin/sessions?q=8801712", get(admin))).json()) as { sessions: { externalId?: string }[] };
    expect(found.sessions).toEqual([expect.objectContaining({ externalId: "8801712345678" })]);
    const detail = (await (await app.request(`/v1/admin/sessions/${sessionId}`, get(admin))).json()) as { messages: unknown[]; runs: unknown[] };
    expect(detail.messages).toHaveLength(2);
    expect(detail.runs).toHaveLength(1);

    const created = await app.request("/v1/admin/keys", json(admin, { user: "dashboard-bot", scopes: ["read"] }));
    expect(created.status).toBe(201);
    const { key, token } = (await created.json()) as { key: { id: string; scopes: string[] }; token: string };
    expect(key.scopes).toEqual(["read"]);
    expect((await app.request("/v1/me", get(token))).status).toBe(200);
    const keys = (await (await app.request("/v1/admin/keys", get(admin))).json()) as { keys: { id: string; status: string }[] };
    expect(keys.keys.find((k) => k.id === key.id)?.status).toBe("active");
    expect(JSON.stringify(keys)).not.toContain("hash");
    expect((await app.request(`/v1/admin/keys/${key.id}/revoke`, json(admin, {}))).status).toBe(200);
    expect((await app.request("/v1/me", get(token))).status).toBe(401);
    const adminKeyId = ((await (await app.request("/v1/me", get(admin))).json()) as { key: { id: string } }).key.id;
    expect((await app.request(`/v1/admin/keys/${adminKeyId}/revoke`, json(admin, {}))).status).toBe(409);
    expect((await audit.list({ action: "key.created" })).map((e) => e.metadata?.via)).toContain("api");
  });

  it("serves the dashboard with SPA fallback, caching and CSP, and blocks path traversal", async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "banglaclaw-dash-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
    writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
    const { deps } = await makeDeps();
    const app = createGatewayApp({ ...deps, dashboardDir: dir });

    expect((await app.request("/admin")).status).toBe(301);
    const index = await app.request("/admin/");
    expect(await index.text()).toContain("id=root");
    expect(index.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    const asset = await app.request("/admin/assets/app-abc123.js");
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await (await app.request("/admin/conversations/123")).text()).toContain("id=root");
    expect((await app.request("/admin/missing.js")).status).toBe(404);
    expect((await app.request("/admin/..%2f..%2fetc%2fpasswd")).status).toBe(404);
  });
});

describe("gateway session events (SSE)", () => {
  it("streams operator replies to the session owner and enforces ownership", async () => {
    const { deps, alice, bob } = await makeDeps();
    const ops = (await deps.auth.issueKey("ops", "default", "operator")).token;
    const app = createGatewayApp(deps);
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const created = (await (await app.request("/v1/sessions", { method: "POST", headers: { ...auth(alice), "Content-Type": "application/json" }, body: "{}" })).json()) as { session: { id: string } };
    const sessionId = created.session.id;
    await deps.sessions.update(sessionId, { status: "handoff" });

    expect((await app.request(`/v1/sessions/${sessionId}/events`, { headers: auth(bob) })).status).toBe(404);

    const controller = new AbortController();
    const res = await app.request(`/v1/sessions/${sessionId}/events`, { headers: auth(alice), signal: controller.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error("no body");
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntil = async (needle: string) => {
      while (!buffer.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before ${needle}`);
        buffer += decoder.decode(value, { stream: true });
      }
    };
    await readUntil("event: ready");

    const reply = await app.request(`/v1/handoffs/${sessionId}/reply`, { method: "POST", headers: { ...auth(ops), "Content-Type": "application/json" }, body: JSON.stringify({ text: "Operator here" }) });
    expect(await reply.json()).toMatchObject({ delivered: true });
    await readUntil("event: operator_message");
    const events = parseSSE(buffer.slice(0, buffer.lastIndexOf("\n\n") + 2));
    expect(events.map((e) => e.event)).toEqual(["ready", "operator_message"]);
    expect(events[1]?.data).toMatchObject({ type: "operator_message", sessionId, text: "Operator here" });
    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it("limits open event streams per key", async () => {
    const { deps, alice } = await makeDeps();
    const app = createGatewayApp(deps);
    const headers = { Authorization: `Bearer ${alice}` };
    const created = (await (await app.request("/v1/sessions", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })).json()) as { session: { id: string } };
    const open: Response[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await app.request(`/v1/sessions/${created.session.id}/events`, { headers });
      expect(res.status).toBe(200);
      open.push(res);
    }
    const over = await app.request(`/v1/sessions/${created.session.id}/events`, { headers });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: { code: "too_many_event_streams" } });
    // A client disconnect (the response body is cancelled) frees the slot.
    await open[0]?.body?.cancel();
    await vi.waitFor(async () => {
      const again = await app.request(`/v1/sessions/${created.session.id}/events`, { headers });
      expect(again.status).toBe(200);
      open.push(again);
    });
    await Promise.all(open.slice(1).map((r) => r.body?.cancel()));
  });
});

