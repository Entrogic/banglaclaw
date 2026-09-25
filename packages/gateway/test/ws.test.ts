import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startGateway, type RunningGateway } from "../src/index.js";
import { GatedProvider, makeDeps } from "./helpers.js";

let gateways: RunningGateway[] = [];
afterEach(async () => {
  await Promise.all(gateways.map((g) => g.close()));
  gateways = [];
});

type Msg = { type: string; ref?: string; [k: string]: unknown };

function client(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url.replace("http", "ws") + "/v1/ws", { headers });
  const inbox: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as Msg;
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  const opened = new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
  const next = (pred: (m: Msg) => boolean) =>
    new Promise<Msg>((resolve) => {
      const found = inbox.find(pred);
      if (found !== undefined) resolve(found);
      else waiters.push({ pred, resolve });
    });
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  return { ws, inbox, opened, closed, next, send };
}

describe("gateway WebSocket", () => {
  it("authenticates by message, streams events and supports concurrent refs", async () => {
    const { deps, alice } = await makeDeps({ script: [{ content: "salam" }] });
    const gw = await startGateway(deps);
    gateways.push(gw);
    const c = client(gw.url);
    await c.opened;

    c.send({ type: "run", text: "hi" });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ error: { code: "unauthenticated" } });

    c.send({ type: "auth", apiKey: alice });
    expect(await c.next((m) => m.type === "ready")).toMatchObject({ user: { name: "alice" } });

    c.send({ type: "ping" });
    await c.next((m) => m.type === "pong");

    c.send({ type: "run", ref: "a", text: "hello" });
    const done = await c.next((m) => m.type === "done" && m.ref === "a");
    expect(done).toMatchObject({ run: { status: "completed", output: "salam" } });
    const events = c.inbox.filter((m) => m.type === "event" && m.ref === "a").map((m) => (m.event as { type: string }).type);
    expect(events).toEqual(["run_start", "token", "final"]);

    c.send({ type: "run", ref: "b", text: "again", sessionId: done.sessionId });
    expect(await c.next((m) => m.type === "done" && m.ref === "b")).toMatchObject({ sessionId: done.sessionId });

    c.send({ type: "nonsense" });
    expect(await c.next((m) => m.type === "error" && (m.error as { code: string }).code === "invalid_message")).toBeDefined();
    c.ws.close();
  });

  it("accepts an Authorization header on upgrade and closes on a bad key", async () => {
    const { deps, alice } = await makeDeps();
    const gw = await startGateway(deps);
    gateways.push(gw);
    const good = client(gw.url, { Authorization: `Bearer ${alice}` });
    expect(await good.next((m) => m.type === "ready")).toMatchObject({ user: { name: "alice" } });
    good.ws.close();

    const bad = client(gw.url);
    await bad.opened;
    bad.send({ type: "auth", apiKey: "bck_000000000000_" + "a".repeat(40) });
    expect(await bad.closed).toBe(4401);
  });

  it("cancels a running run", async () => {
    const provider = new GatedProvider();
    const { deps, alice } = await makeDeps({ provider });
    const gw = await startGateway(deps);
    gateways.push(gw);
    const c = client(gw.url, { Authorization: `Bearer ${alice}` });
    await c.next((m) => m.type === "ready");
    c.send({ type: "run", ref: "slow", text: "wait" });
    await provider.started;
    c.send({ type: "cancel", ref: "slow" });
    expect(await c.next((m) => m.type === "done" && m.ref === "slow")).toMatchObject({ run: { status: "aborted", error: "Run cancelled" } });
    c.ws.close();
  });

  it("pushes operator replies and releases to subscribed sessions only", async () => {
    const { deps, alice, bob } = await makeDeps({ script: [{ content: "salam" }] });
    const ops = (await deps.auth.issueKey("ops", "default", "operator")).token;
    const gw = await startGateway(deps);
    gateways.push(gw);
    const a = client(gw.url, { Authorization: `Bearer ${alice}` });
    await a.next((m) => m.type === "ready");
    a.send({ type: "run", ref: "r", text: "hello" });
    const { sessionId } = (await a.next((m) => m.type === "done")) as unknown as { sessionId: string };
    await deps.sessions.update(sessionId, { status: "handoff", handoffReason: "refund" });

    a.send({ type: "subscribe", sessionId });
    expect(await a.next((m) => m.type === "subscribed")).toMatchObject({ sessionId });

    // Another user can't follow alice's session, and learns nothing about it.
    const b = client(gw.url, { Authorization: `Bearer ${bob}` });
    await b.next((m) => m.type === "ready");
    b.send({ type: "subscribe", sessionId });
    expect(await b.next((m) => m.type === "error")).toMatchObject({ error: { code: "session_not_found" } });

    const post = (path: string, body: unknown) =>
      fetch(`${gw.url}${path}`, { method: "POST", headers: { Authorization: `Bearer ${ops}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const reply = await post(`/v1/handoffs/${sessionId}/reply`, { text: "আমি করিম, সাপোর্ট থেকে।" });
    expect(await reply.json()).toMatchObject({ delivered: true });
    expect(await a.next((m) => m.type === "session_event")).toMatchObject({ sessionId, event: { type: "operator_message", sessionId, text: "আমি করিম, সাপোর্ট থেকে।" } });

    await post(`/v1/handoffs/${sessionId}/release`, {});
    expect(await a.next((m) => m.type === "session_event" && (m.event as { type: string }).type === "handoff_released")).toMatchObject({ sessionId });
    expect(b.inbox.some((m) => m.type === "session_event")).toBe(false);

    // After unsubscribing (and with nobody else following), a reply is stored but not pushed.
    a.send({ type: "unsubscribe", sessionId });
    a.send({ type: "ping" });
    await a.next((m) => m.type === "pong");
    await deps.sessions.update(sessionId, { status: "handoff" });
    expect(await (await post(`/v1/handoffs/${sessionId}/reply`, { text: "still there?" })).json()).toMatchObject({ delivered: false });
    a.ws.close();
    b.ws.close();
  });
});

