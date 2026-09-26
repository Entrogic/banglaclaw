import { describe, expect, it } from "vitest";
import { createGatewayApp, VisitorTokens, type WidgetOptions } from "../src/index.js";
import { MARKDOWN_JS } from "../src/browser-markdown.js";
import { makeDeps, parseSSE } from "./helpers.js";

const widget = (over: Partial<WidgetOptions> = {}): WidgetOptions => ({
  allowedOrigins: ["https://shop.example.com"],
  title: "Dokan Help",
  greeting: "আসসালামু আলাইকুম!",
  color: "#0b6b4f",
  position: "right",
  messagesPerMinute: 10,
  sessionsPerMinute: 10,
  maxInputChars: 200,
  maxConcurrentRuns: 5,
  visitorTtlDays: 30,
  secret: "test-secret-that-is-long-enough-000000",
  ...over,
});

const post = (body: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token !== undefined && { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body),
});
const bearer = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });

async function visitorToken(app: ReturnType<typeof createGatewayApp>, body: unknown = {}): Promise<string> {
  const res = await app.request("/widget/api/session", post(body));
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe("visitor tokens", () => {
  it("verifies its own tokens and rejects tampered, foreign and expired ones", () => {
    let now = 1_000;
    const tokens = new VisitorTokens("secret-a", 60, () => now);
    const { token, visitor } = tokens.issue();
    expect(tokens.verify(token)).toEqual(visitor);
    expect(tokens.verify(token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA"))).toBeUndefined();
    expect(new VisitorTokens("secret-b", 60, () => now).verify(token)).toBeUndefined();
    expect(tokens.verify(token.replace(visitor.visitorId, "00000000-0000-4000-8000-000000000000"))).toBeUndefined();
    expect(tokens.verify("garbage")).toBeUndefined();
    now = 1_061;
    expect(tokens.verify(token)).toBeUndefined();
  });
});

describe("browser markdown renderer", () => {
  const md = new Function(`${MARKDOWN_JS}\nreturn md;`)() as (text: string) => string;

  it("escapes HTML and only links http(s) URLs", () => {
    const html = md('<img src=x onerror="alert(1)"> **bold** [ok](https://example.com) [bad](javascript:alert(1))');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(html).not.toContain('href="javascript:');
    expect(md("```\n<script>x</script>\n```")).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});

describe("website widget", () => {
  it("is not served unless configured", async () => {
    const { deps } = await makeDeps();
    const app = createGatewayApp(deps);
    for (const path of ["/widget.js", "/widget/frame"]) expect((await app.request(path)).status).toBe(404);
    expect((await app.request("/widget/api/session", post({}))).status).toBe(404);
  });

  it("serves a loader with the settings baked in and a frame only the allowed sites may embed", async () => {
    const { deps } = await makeDeps();
    const app = createGatewayApp({ ...deps, widget: widget({ allowedOrigins: ["https://shop.example.com", "http://localhost:5173"] }) });

    const js = await app.request("/widget.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    const source = await js.text();
    expect(source).toContain('"title":"Dokan Help"');
    expect(source).toContain("/widget/frame?origin=");
    expect(() => new Function(source)).not.toThrow();

    const frame = await app.request("/widget/frame");
    expect(frame.headers.get("content-security-policy")).toContain("frame-ancestors https://shop.example.com http://localhost:5173");
    expect(frame.headers.get("x-frame-options")).toBeNull();
    const html = await frame.text();
    for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new Function(script ?? "")).not.toThrow();
  });

  it("chats with an anonymous visitor over SSE without exposing tool details", async () => {
    const { deps } = await makeDeps({
      script: [{ toolCalls: [{ name: "calculator", args: { expression: "25*4" } }] }, { content: "উত্তর: ১০০" }],
    });
    const app = createGatewayApp({ ...deps, widget: widget() });
    const token = await visitorToken(app);

    expect((await app.request("/widget/api/messages", post({ text: "hi" }))).status).toBe(401);
    expect((await app.request("/widget/api/messages", post({ text: "x".repeat(201) }, token))).status).toBe(400);

    const res = await app.request("/widget/api/messages", post({ text: "২৫ * ৪ কত?" }, token));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    const events = parseSSE(body);
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(["activity", "token", "done"]));
    expect(events.at(-1)).toEqual({ event: "done", data: { status: "completed", reply: "উত্তর: ১০০" } });
    expect(body).not.toContain("calculator");
    expect(body).not.toContain("25*4");

    const sessions = await deps.sessions.list({ channel: "widget" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.userId).toBeUndefined();

    const history = (await (await app.request("/widget/api/history", bearer(token))).json()) as { messages: { role: string; text: string }[] };
    expect(history.messages).toEqual([
      { role: "user", text: "২৫ * ৪ কত?" },
      { role: "assistant", text: "উত্তর: ১০০" },
    ]);
  });

  it("keeps the visitor's conversation when a valid token is renewed, and starts over on reset", async () => {
    const { deps } = await makeDeps({ script: [{ content: "one" }, { content: "two" }] });
    const app = createGatewayApp({ ...deps, widget: widget() });
    const first = await visitorToken(app);
    await (await app.request("/widget/api/messages", post({ text: "hello" }, first))).text();

    const renewed = await app.request("/widget/api/session", post({ token: first }));
    const { token: second, resumed } = (await renewed.json()) as { token: string; resumed: boolean };
    expect(resumed).toBe(true);
    const history = (await (await app.request("/widget/api/history", bearer(second))).json()) as { messages: unknown[] };
    expect(history.messages).toHaveLength(2);

    expect((await app.request("/widget/api/reset", post({}, second))).status).toBe(204);
    expect(await (await app.request("/widget/api/history", bearer(second))).json()).toEqual({ messages: [], handoff: false });
    await (await app.request("/widget/api/messages", post({ text: "again" }, second))).text();
    expect(await deps.sessions.list({ channel: "widget" })).toHaveLength(2);
  });

  it("rate limits messages per visitor and new visitors per IP", async () => {
    const { deps } = await makeDeps({ script: [{ content: "a" }, { content: "b" }, { content: "c" }] });
    const app = createGatewayApp({ ...deps, widget: widget({ messagesPerMinute: 2, sessionsPerMinute: 2 }) });
    const token = await visitorToken(app);
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/widget/api/messages", post({ text: `m${i}` }, token));
      expect(res.status).toBe(200);
      await res.text();
    }
    const limited = await app.request("/widget/api/messages", post({ text: "m3" }, token));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();

    await visitorToken(app);
    expect((await app.request("/widget/api/session", post({}))).status).toBe(429);
    // Renewing an existing token is not a new visitor.
    expect((await app.request("/widget/api/session", post({ token }))).status).toBe(200);
  });

  it("pushes operator replies to the visitor's event stream", async () => {
    const { deps } = await makeDeps({ script: [{ content: "bot" }] });
    const ops = (await deps.auth.issueKey("ops", "console", "operator")).token;
    const app = createGatewayApp({ ...deps, widget: widget() });
    const token = await visitorToken(app);
    expect((await app.request("/widget/api/events", bearer(token))).status).toBe(404);
    await (await app.request("/widget/api/messages", post({ text: "manusher sathe kotha bolbo" }, token))).text();
    const [session] = await deps.sessions.list({ channel: "widget" });
    if (session === undefined) throw new Error("no session");
    await deps.sessions.update(session.id, { status: "handoff", handoffReason: "asked for a human" });

    const controller = new AbortController();
    const res = await app.request("/widget/api/events", { ...bearer(token), signal: controller.signal });
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
    const reply = await app.request(`/v1/handoffs/${session.id}/reply`, post({ text: "আমি রাফি, বলুন।" }, ops));
    expect(await reply.json()).toMatchObject({ delivered: true });
    await readUntil("event: operator");
    expect(parseSSE(buffer.slice(0, buffer.lastIndexOf("\n\n") + 2)).at(-1)).toEqual({ event: "operator", data: { text: "আমি রাফি, বলুন।" } });
    controller.abort();
    await reader.cancel().catch(() => undefined);

    const history = (await (await app.request("/widget/api/history", bearer(token))).json()) as { messages: { role: string }[]; handoff: boolean };
    expect(history.handoff).toBe(true);
    expect(history.messages.at(-1)).toEqual({ role: "operator", text: "আমি রাফি, বলুন।" });
  });
});
