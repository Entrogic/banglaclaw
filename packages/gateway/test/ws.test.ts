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
});
