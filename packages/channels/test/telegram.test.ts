import { describe, expect, it } from "vitest";
import { TelegramApi, TelegramChannel, toInbound, type TelegramUpdate } from "../src/index.js";
import { fakeFetch, makeRouter } from "./helpers.js";

const TOKEN = "123456:ABCdefGHIjklMNOpqrSTUvwxyz_0123";
const update = (id: number, text: string | undefined, from = 100, chatType = "private"): TelegramUpdate => ({
  update_id: id,
  message: { message_id: id, chat: { id: from, type: chatType }, from: { id: from, first_name: "Rahim" }, ...(text !== undefined && { text }) },
});

describe("Telegram", () => {
  it("normalises private text messages and ignores groups and bots", () => {
    expect(toInbound(update(1, "hi"))).toEqual({ conversationId: "100", senderId: "100", senderName: "Rahim", text: "hi" });
    expect(toInbound(update(2, "hi", 100, "group"))).toBeUndefined();
    expect(toInbound({ update_id: 3 })).toBeUndefined();
    expect(() => new TelegramApi("not-a-token")).toThrow(/bot token/);
  });

  it("reports network failures without leaking the token", async () => {
    const failing = async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND tg.test"), { code: "ENOTFOUND" }) });
    };
    const api = new TelegramApi(TOKEN, { fetch: failing, baseUrl: "https://tg.test" });
    const error = await api.getMe().then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toBe("Telegram getMe failed (0): cannot reach tg.test (ENOTFOUND)");
    expect(error?.message).not.toContain(TOKEN);
  });

  it("long-polls, replies through the Bot API and stops cleanly", async () => {
    const { router } = makeRouter({ script: [{ content: "উত্তর" }] });
    let served = false;
    const api = fakeFetch(async (url, body) => {
      if (url.endsWith("/getUpdates")) {
        if (!served) {
          served = true;
          return { ok: true, result: [update(10, "প্রশ্ন"), update(11, "stranger", 555)] };
        }
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, result: [] };
      }
      return { ok: true, result: body.chat_id !== undefined ? { message_id: 1 } : true };
    });
    const channel = new TelegramChannel({ api: new TelegramApi(TOKEN, { fetch: api.fn, baseUrl: "https://tg.test" }), router, pollTimeoutSeconds: 0 });
    await channel.startPolling();
    await expect.poll(() => api.calls.filter((c) => c.url.endsWith("/sendMessage")).length, { timeout: 3_000 }).toBe(2);
    await channel.stopPolling();
    await router.drain();

    expect(api.calls[0]?.url).toBe(`https://tg.test/bot${TOKEN}/deleteWebhook`);
    const sends = api.calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => [c.body.chat_id, c.body.text]);
    expect(sends).toContainEqual(["100", "উত্তর"]);
    expect(sends.find(([chat]) => chat === "555")?.[1]).toMatch(/permission|allowed/i);
    const secondPoll = api.calls.filter((c) => c.url.endsWith("/getUpdates"))[1];
    expect(secondPoll?.body.offset).toBe(12);
  });

  it("accepts webhook updates only with the secret token", async () => {
    const { router } = makeRouter();
    const api = fakeFetch(() => ({ ok: true, result: true }));
    const channel = new TelegramChannel({ api: new TelegramApi(TOKEN, { fetch: api.fn }), router });
    const app = channel.webhookApp("s3cret-token");
    const post = (secret: string | undefined, body: unknown) =>
      app.request("/channels/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(secret !== undefined && { "X-Telegram-Bot-Api-Secret-Token": secret }) },
        body: JSON.stringify(body),
      });
    expect((await post(undefined, update(1, "hi"))).status).toBe(401);
    expect((await post("wrong", update(1, "hi"))).status).toBe(401);
    expect((await post("s3cret-token", { garbage: true })).status).toBe(200);
    expect((await post("s3cret-token", update(2, "hi"))).status).toBe(200);
    await router.drain();
    expect(api.calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.body.text)).toEqual(["reply"]);

    await channel.registerWebhook("https://bot.example.com", "s3cret-token");
    expect(api.calls.at(-1)?.body).toMatchObject({ url: "https://bot.example.com/channels/telegram/webhook", secret_token: "s3cret-token" });
  });
});
