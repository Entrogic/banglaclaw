import { describe, expect, it } from "vitest";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { FakeProvider, type ModelCallOptions, type ModelProvider, type ScriptedTurn } from "@entrogic-net/providers";
import { TelegramApi, TelegramChannel, splitMessage, type ChannelAdapter, type EditableReplies } from "../src/index.js";
import { fakeFetch, makeRouter, silent } from "./helpers.js";

/** An adapter that can edit messages; records what the user would see. */
class EditingAdapter implements ChannelAdapter {
  readonly name = "test";
  readonly messages = new Map<string, string>();
  readonly order: string[] = [];
  readonly sent: string[] = [];
  edits = 0;
  typingCount = 0;
  failEdits = false;
  readonly editable: EditableReplies;
  constructor(readonly maxMessageLength = 4096) {
    this.editable = {
      post: async (_chat, text) => {
        const id = String(this.order.length + 1);
        this.order.push(id);
        this.messages.set(id, text);
        return id;
      },
      edit: async (_chat, id, text) => {
        if (this.failEdits) throw new Error("edit failed");
        this.edits++;
        this.messages.set(id, text);
      },
      remove: async (_chat, id) => {
        this.messages.delete(id);
        this.order.splice(this.order.indexOf(id), 1);
      },
    };
  }
  async send(_chat: string, text: string) {
    this.sent.push(text);
  }
  async typing() {
    this.typingCount++;
  }
  /** Every message the user sees, in order. */
  visible(): string[] {
    return [...this.order.map((id) => this.messages.get(id) ?? ""), ...this.sent];
  }
}

/** Streams the scripted turns a few milliseconds apart, like a real model. */
class SlowProvider implements ModelProvider {
  readonly id = "slow:scripted";
  readonly #inner: FakeProvider;
  constructor(script: ScriptedTurn[]) {
    this.#inner = new FakeProvider(script);
  }
  chat(messages: BaseMessage[], options?: ModelCallOptions) {
    return this.#inner.chat(messages, options);
  }
  async *stream(messages: BaseMessage[], options?: ModelCallOptions): AsyncIterable<AIMessageChunk> {
    for await (const chunk of this.#inner.stream(messages, options)) {
      await new Promise((r) => setTimeout(r, 3));
      yield chunk;
    }
  }
}

const inbound = { conversationId: "c1", senderId: "100", text: "প্রশ্ন" };
const live = { intervalMs: 0, minChars: 10 };

describe("live replies", () => {
  it("posts once enough text arrived, edits as tokens stream, and ends on the final text without a cursor", async () => {
    const text = "ঢাকায় আজ আবহাওয়া রোদেলা, তাপমাত্রা ৩২ ডিগ্রি। সন্ধ্যায় হালকা বৃষ্টি হতে পারে।";
    const { router } = makeRouter({ provider: new SlowProvider([{ content: text }]), liveReplies: live });
    const adapter = new EditingAdapter();
    await router.handle(adapter, inbound);
    expect(adapter.visible()).toEqual([text]);
    expect(adapter.order).toHaveLength(1);
    expect(adapter.edits).toBeGreaterThan(0);
    expect(adapter.sent).toEqual([]);
  });

  it("sends short replies normally instead of posting a draft", async () => {
    const { router } = makeRouter({ provider: new SlowProvider([{ content: "ঠিক আছে" }]), liveReplies: live });
    const adapter = new EditingAdapter();
    await router.handle(adapter, inbound);
    expect(adapter.order).toEqual([]);
    expect(adapter.sent).toEqual(["ঠিক আছে"]);
  });

  it("spills long replies into more messages at the length limit", async () => {
    const text = Array.from({ length: 30 }, (_, i) => `শব্দ${i}`).join(" ");
    const { router } = makeRouter({ provider: new SlowProvider([{ content: text }]), liveReplies: live });
    const adapter = new EditingAdapter(60);
    await router.handle(adapter, inbound);
    expect(adapter.visible()).toEqual(splitMessage(text, 60));
    expect(adapter.order.length).toBeGreaterThan(1);
    expect(adapter.sent).toEqual([]);
    expect(adapter.visible().every((m) => !m.includes("▍"))).toBe(true);
  });

  it("replaces text written before a tool call with the answer after it", async () => {
    const { router } = makeRouter({
      provider: new SlowProvider([
        { content: "একটু দাঁড়ান, হিসাবটা করে দেখছি আপনার জন্য।", toolCalls: [{ name: "calculator", args: { expression: "25*4" } }] },
        { content: "২৫ গুণ ৪ হলো ১০০, এটাই আপনার উত্তর।" },
      ]),
      liveReplies: live,
    });
    const adapter = new EditingAdapter();
    const seen: string[] = [];
    const edit = adapter.editable.edit;
    Object.assign(adapter.editable, { edit: async (c: string, id: string, t: string) => { seen.push(t); await edit(c, id, t); } });
    await router.handle(adapter, inbound);
    expect(seen.some((t) => t.startsWith("একটু দাঁড়ান"))).toBe(true);
    expect(adapter.visible()).toEqual(["২৫ গুণ ৪ হলো ১০০, এটাই আপনার উত্তর।"]);
    expect(adapter.order).toHaveLength(1);
  });

  it("falls back to normal messages when editing fails", async () => {
    const text = "এটা একটা লম্বা উত্তর যেটা ধাপে ধাপে লেখা হচ্ছে এবং শেষে পুরোটা দেখা যাবে।";
    const { router } = makeRouter({ provider: new SlowProvider([{ content: text }]), liveReplies: live });
    const adapter = new EditingAdapter();
    adapter.failEdits = true;
    await router.handle(adapter, inbound);
    expect(adapter.order).toHaveLength(1);
    expect(adapter.sent).toEqual([text]);
  });

  it("can be turned off", async () => {
    const text = "ঢাকায় আজ আবহাওয়া রোদেলা, তাপমাত্রা ৩২ ডিগ্রি।";
    const { router } = makeRouter({ script: [{ content: text }], liveReplies: false });
    const adapter = new EditingAdapter();
    await router.handle(adapter, inbound);
    expect(adapter.order).toEqual([]);
    expect(adapter.sent).toEqual([text]);
  });
});

describe("Telegram live replies", () => {
  it("posts with sendMessage, edits with editMessageText and ignores 'not modified'", async () => {
    let next = 40;
    const api = fakeFetch((url) => {
      if (url.endsWith("/sendMessage")) return { ok: true, result: { message_id: next++ } };
      if (url.endsWith("/editMessageText")) return { ok: false, description: "Bad Request: message is not modified" };
      return { ok: true, result: true };
    });
    const telegram = new TelegramApi("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ", { fetch: api.fn });
    const channel = new TelegramChannel({ api: telegram, router: makeRouter().router, logger: silent });
    const editable = channel.editable;
    if (editable === undefined) throw new Error("live replies should be on by default");
    expect(await editable.post("7", "hello")).toBe("40");
    await expect(editable.edit("7", "40", "hello")).resolves.toBeUndefined();
    expect(api.calls.map((c) => [c.url.split("/").at(-1), c.body.message_id])).toEqual([["sendMessage", undefined], ["editMessageText", 40]]);
    expect(new TelegramChannel({ api: telegram, router: makeRouter().router, liveReplies: false }).editable).toBeUndefined();
  });
});
