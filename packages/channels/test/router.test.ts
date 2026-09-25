import { describe, expect, it } from "vitest";
import { notice, splitMessage } from "../src/index.js";
import { RecordingAdapter, makeRouter } from "./helpers.js";

describe("splitMessage", () => {
  it("keeps short text whole and splits long text on boundaries", () => {
    expect(splitMessage("hello", 10)).toEqual(["hello"]);
    const parts = splitMessage("aaaa bbbb cccc dddd", 10);
    expect(parts).toEqual(["aaaa bbbb", "cccc dddd"]);
    expect(splitMessage("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
    for (const part of splitMessage("আমি ভালো আছি ".repeat(50), 40)) expect([...part].length).toBeLessThanOrEqual(40);
  });
});

describe("ChannelRouter", () => {
  it("answers allowed senders in a per-conversation session", async () => {
    const { router, provider, sessions } = makeRouter({ script: [{ content: "one" }, { content: "two" }] });
    const adapter = new RecordingAdapter();
    await router.handle(adapter, { conversationId: "c1", senderId: "100", text: "hi" });
    await router.handle(adapter, { conversationId: "c1", senderId: "100", text: "again" });
    expect(adapter.sent).toEqual([["c1", "one"], ["c1", "two"]]);
    expect(adapter.typingCount).toBeGreaterThan(0);
    const session = await sessions.findByExternalId("test", "c1");
    expect(await sessions.countMessages(session?.id ?? "")).toBe(4);
    expect(provider.calls[1]?.messages.map((m) => m.content).slice(1)).toEqual(["hi", "one", "again"]);
  });

  it("refuses senders outside the allowlist without calling the model", async () => {
    const { router, provider } = makeRouter();
    const adapter = new RecordingAdapter();
    await router.handle(adapter, { conversationId: "c9", senderId: "999", text: "আমাকে সাহায্য করো" });
    expect(adapter.sent).toEqual([["c9", notice("notAllowed", "bn")]]);
    expect(provider.calls).toHaveLength(0);
    // Refusals are rate limited too, so a stranger can't make the bot spam.
    for (let i = 0; i < 200; i++) await router.handle(adapter, { conversationId: "c9", senderId: "999", text: "x" });
    expect(adapter.sent.length).toBeLessThan(150);
  });

  it("allows everyone in open mode", async () => {
    const { router } = makeRouter({ access: { access: "open", allowed: [] } });
    const adapter = new RecordingAdapter();
    await router.handle(adapter, { conversationId: "c", senderId: "anyone", text: "hi" });
    expect(adapter.sent).toEqual([["c", "reply"]]);
  });

  it("handles /start, /new and non-text messages", async () => {
    const { router, sessions, provider } = makeRouter({ script: [{ content: "a" }, { content: "b" }] });
    const adapter = new RecordingAdapter();
    await router.handle(adapter, { conversationId: "c", senderId: "100", text: "/start" });
    expect(adapter.sent[0]?.[1]).toBe(notice("welcome", "bn"));
    await router.handle(adapter, { conversationId: "c", senderId: "100" });
    expect(adapter.sent[1]?.[1]).toBe(notice("textOnly", "bn"));

    await router.handle(adapter, { conversationId: "c", senderId: "100", text: "first" });
    const first = await sessions.findByExternalId("test", "c");
    await router.handle(adapter, { conversationId: "c", senderId: "100", text: "/new@my_bot" });
    expect(adapter.sent.at(-1)?.[1]).toBe(notice("newSession", "en"));
    await router.handle(adapter, { conversationId: "c", senderId: "100", text: "second" });
    const second = await sessions.findByExternalId("test", "c");
    expect(second?.id).not.toBe(first?.id);
    expect(provider.calls[1]?.messages.map((m) => m.content).slice(1)).toEqual(["second"]);
  });

  it("rate limits per conversation", async () => {
    const { router, provider } = makeRouter({ rateLimitPerMinute: 2 });
    const adapter = new RecordingAdapter();
    for (const text of ["1", "2", "3"]) await router.handle(adapter, { conversationId: "c", senderId: "100", text });
    expect(provider.calls).toHaveLength(2);
    expect(adapter.sent.at(-1)?.[1]).toBe(notice("rateLimited", "en"));
  });

  it("processes one conversation in order even when messages arrive together", async () => {
    const { router } = makeRouter({ script: [{ content: "r1" }, { content: "r2" }, { content: "r3" }] });
    const adapter = new RecordingAdapter();
    await Promise.all(["m1", "m2", "m3"].map((text) => router.handle(adapter, { conversationId: "c", senderId: "100", text })));
    expect(adapter.sent.map(([, t]) => t)).toEqual(["r1", "r2", "r3"]);
  });

  it("splits long replies and sends a localized error when the run fails", async () => {
    const { router } = makeRouter({ script: [{ content: "word ".repeat(30) }] });
    const adapter = new RecordingAdapter(40);
    await router.handle(adapter, { conversationId: "c", senderId: "100", text: "long please" });
    expect(adapter.sent.length).toBeGreaterThan(1);

    const failing = makeRouter({ provider: { id: "x", chat: () => Promise.reject(new Error("x")), stream: async function* () { throw new Error("down"); } } });
    const a2 = new RecordingAdapter();
    await failing.router.handle(a2, { conversationId: "c", senderId: "100", text: "ekhon koyta baje?" });
    expect(a2.sent).toEqual([["c", notice("failed", "bn-en")]]);
  });
});
