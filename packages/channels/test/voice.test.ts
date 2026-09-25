import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AudioInput, Transcriber } from "@banglaclaw/shared";
import { MessengerApi, MessengerChannel, TelegramApi, TelegramChannel, WhatsAppApi, WhatsAppChannel, type VoiceOptions } from "../src/index.js";
import { fakeFetch, makeRouter } from "./helpers.js";

const TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Transcriber stub that records what it was given. */
function transcriber(result: string | Error = "আজকে ঢাকার আবহাওয়া কেমন?") {
  const heard: (AudioInput & { language?: string })[] = [];
  const t: Transcriber = {
    id: "stub",
    transcribe: async (audio, options) => {
      heard.push({ ...audio, ...(options?.language !== undefined && { language: options.language }) });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { t, heard };
}

function telegram(options: { voice?: VoiceOptions; allowed?: string[]; script?: { content: string }[] } = {}) {
  const { router, provider } = makeRouter({
    access: { access: "allowlist", allowed: options.allowed ?? ["100"] },
    ...(options.voice !== undefined && { voice: options.voice }),
    ...(options.script !== undefined && { script: options.script }),
  });
  const api = fakeFetch((url) => {
    if (url.endsWith("/getFile")) return { ok: true, result: { file_id: "f1", file_path: "voice/file_7.oga", file_size: 5 } };
    if (url.includes("/file/bot")) return { audio: "bytes" };
    return { ok: true, result: {} };
  });
  const channel = new TelegramChannel({ api: new TelegramApi(TOKEN, { fetch: api.fn, baseUrl: "https://tg.test" }), router });
  const voiceUpdate = (duration: number, from = 100) => ({
    update_id: 1,
    message: { message_id: 1, chat: { id: from, type: "private" }, from: { id: from, first_name: "Rahim" }, voice: { file_id: "f1", duration, mime_type: "audio/ogg" } },
  });
  const sent = () => api.calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => c.body.text);
  const downloaded = () => api.calls.some((c) => c.url.endsWith("/getFile"));
  return { channel, router, provider, api, voiceUpdate, sent, downloaded };
}

describe("voice notes", () => {
  it("transcribes a Telegram voice note and answers the transcript", async () => {
    const { t, heard } = transcriber();
    const tg = telegram({ voice: { transcriber: t, language: "bn", maxSeconds: 120 }, script: [{ content: "আজ ঢাকায় রোদ, ৩২°সে।" }] });
    tg.channel.dispatch(tg.voiceUpdate(6));
    await tg.router.drain();

    expect(tg.api.calls.map((c) => c.url)).toContain(`https://tg.test/file/bot${TOKEN}/voice/file_7.oga`);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ mimeType: "audio/ogg", filename: "voice.ogg", language: "bn" });
    // The model sees the transcript as the user's message.
    const userTurn = tg.provider.calls[0]?.messages.at(-1);
    expect(userTurn?.content).toBe("আজকে ঢাকার আবহাওয়া কেমন?");
    expect(tg.sent()).toEqual(["আজ ঢাকায় রোদ, ৩২°সে।"]);
  });

  it("refuses long voice notes before downloading them", async () => {
    const { t, heard } = transcriber();
    const tg = telegram({ voice: { transcriber: t, maxSeconds: 60 } });
    tg.channel.dispatch(tg.voiceUpdate(300));
    await tg.router.drain();
    expect(tg.downloaded()).toBe(false);
    expect(heard).toHaveLength(0);
    expect(tg.sent()).toEqual(["ভয়েস বার্তাটি অনেক লম্বা। ছোট করে আবার পাঠান, অথবা লিখে পাঠান।"]);
  });

  it("never downloads audio from senders outside the allowlist", async () => {
    const { t } = transcriber();
    const tg = telegram({ voice: { transcriber: t, maxSeconds: 120 }, allowed: ["1"] });
    tg.channel.dispatch(tg.voiceUpdate(5));
    await tg.router.drain();
    expect(tg.downloaded()).toBe(false);
    expect(tg.sent()).toEqual(["দুঃখিত, এই বট ব্যবহারের অনুমতি আপনার নেই।"]);
  });

  it("answers with a notice when transcription fails or is empty", async () => {
    for (const result of [new Error("stt down"), "   "]) {
      const { t } = transcriber(result);
      const tg = telegram({ voice: { transcriber: t, maxSeconds: 120 } });
      tg.channel.dispatch(tg.voiceUpdate(5));
      await tg.router.drain();
      expect(tg.sent()).toEqual(["দুঃখিত, ভয়েস বার্তাটি বুঝতে পারিনি। অনুগ্রহ করে আবার বলুন বা লিখে পাঠান।"]);
      expect(tg.provider.calls).toHaveLength(0);
    }
  });

  it("keeps the text-only notice when voice is off", async () => {
    const tg = telegram();
    tg.channel.dispatch(tg.voiceUpdate(5));
    await tg.router.drain();
    expect(tg.downloaded()).toBe(false);
    expect(tg.sent()).toEqual(["আপাতত শুধু লেখা বার্তা বুঝতে পারি।"]);
  });

  it("downloads WhatsApp voice notes through the Media API with the access token", async () => {
    const { t, heard } = transcriber();
    const { router } = makeRouter({ access: { access: "open", allowed: [] }, voice: { transcriber: t, maxSeconds: 120 } });
    const requests: { url: string; auth: string | null }[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      requests.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url === "https://graph.test/v21.0/media-9") return Response.json({ url: "https://lookaside.test/media-9", mime_type: "audio/ogg; codecs=opus", file_size: 4 });
      if (url === "https://lookaside.test/media-9") return new Response(new Uint8Array([1, 2, 3, 4]));
      return Response.json({ messages: [{ id: "out" }] });
    };
    const channel = new WhatsAppChannel({
      api: new WhatsAppApi({ accessToken: "wa-token", phoneNumberId: "1098", graphApiVersion: "v21.0", fetch: fetchFn, baseUrl: "https://graph.test" }),
      router, appSecret: "s", verifyToken: "v", phoneNumberId: "1098",
    });
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "1098" }, messages: [{ from: "8801700000000", id: "wamid.1", type: "audio", audio: { id: "media-9", mime_type: "audio/ogg; codecs=opus", voice: true } }] } }] }],
    });
    await channel.webhookApp().request("/channels/whatsapp/webhook", { method: "POST", headers: { "X-Hub-Signature-256": `sha256=${createHmac("sha256", "s").update(body).digest("hex")}` }, body });
    await router.drain();
    expect(requests.slice(0, 2)).toEqual([
      { url: "https://graph.test/v21.0/media-9", auth: "Bearer wa-token" },
      { url: "https://lookaside.test/media-9", auth: "Bearer wa-token" },
    ]);
    expect(heard[0]).toMatchObject({ mimeType: "audio/ogg; codecs=opus", filename: "voice.ogg", data: new Uint8Array([1, 2, 3, 4]) });
  });

  it("downloads Messenger audio attachments from their https URL", async () => {
    const { t, heard } = transcriber();
    const { router } = makeRouter({ access: { access: "open", allowed: [] }, voice: { transcriber: t, maxSeconds: 120 } });
    const fetched: string[] = [];
    const fetchFn = async (url: string) => {
      fetched.push(url);
      if (url.startsWith("https://cdn.fb.test/")) return new Response(new Uint8Array([9, 9]), { headers: { "Content-Type": "audio/mp4" } });
      return Response.json({});
    };
    const channel = new MessengerChannel({
      api: new MessengerApi({ pageAccessToken: "p", graphApiVersion: "v21.0", fetch: fetchFn, baseUrl: "https://graph.test" }),
      router, appSecret: "s", verifyToken: "v",
    });
    const body = JSON.stringify({ object: "page", entry: [{ id: "1", messaging: [{ sender: { id: "7001" }, recipient: { id: "1" }, message: { mid: "m", attachments: [{ type: "audio", payload: { url: "https://cdn.fb.test/clip.mp4" } }] } }] }] });
    await channel.webhookApp().request("/channels/messenger/webhook", { method: "POST", headers: { "X-Hub-Signature-256": `sha256=${createHmac("sha256", "s").update(body).digest("hex")}` }, body });
    await router.drain();
    expect(fetched).toContain("https://cdn.fb.test/clip.mp4");
    expect(heard[0]).toMatchObject({ mimeType: "audio/mp4", filename: "voice.m4a" });
  });
});
