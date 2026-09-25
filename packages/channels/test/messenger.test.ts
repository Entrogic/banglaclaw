import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MessengerApi, MessengerChannel, toMessengerInbound } from "../src/index.js";
import { fakeFetch, makeRouter } from "./helpers.js";

const SECRET = "app-secret";
const PAGE = "4455";
const PSID = "7001";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const event = (messaging: Record<string, unknown>, pageId = PAGE) =>
  JSON.stringify({ object: "page", entry: [{ id: pageId, time: 1, messaging: [{ sender: { id: PSID }, recipient: { id: pageId }, timestamp: 1, ...messaging }] }] });

function setup(options: { allowed?: string[]; script?: { content: string }[] } = {}) {
  const { router } = makeRouter({ access: { access: "allowlist", allowed: options.allowed ?? [PSID] }, ...(options.script !== undefined && { script: options.script }) });
  const api = fakeFetch(() => ({ recipient_id: PSID, message_id: "m_out" }));
  const channel = new MessengerChannel({
    api: new MessengerApi({ pageAccessToken: "page-token", graphApiVersion: "v21.0", fetch: api.fn, baseUrl: "https://graph.test" }),
    router, appSecret: SECRET, verifyToken: "verify-me", pageId: PAGE,
  });
  /** `signature: null` sends no signature header. */
  const post = (body: string, signature: string | null = sign(body)) =>
    channel.webhookApp().request("/channels/messenger/webhook", { method: "POST", headers: { "Content-Type": "application/json", ...(signature !== null && { "X-Hub-Signature-256": signature }) }, body });
  const sent = () => api.calls.filter((c) => c.body.message !== undefined).map((c) => (c.body.message as { text: string }).text);
  return { channel, api, router, post, sent };
}

describe("Messenger", () => {
  it("completes the webhook verification handshake", async () => {
    const { channel } = setup();
    const app = channel.webhookApp();
    expect(await (await app.request("/channels/messenger/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=987")).text()).toBe("987");
    expect((await app.request("/channels/messenger/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status).toBe(403);
  });

  it("answers signed text messages with a typing indicator and rejects bad signatures", async () => {
    const { api, router, post, sent } = setup({ script: [{ content: "স্বাগতম! কীভাবে সাহায্য করতে পারি?" }] });
    const body = event({ message: { mid: "m1", text: "হ্যালো" } });
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, sign("tampered"))).status).toBe(401);
    const ok = await post(body);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("EVENT_RECEIVED");
    await router.drain();

    expect(api.calls.every((c) => c.url === "https://graph.test/v21.0/me/messages")).toBe(true);
    expect(api.calls.some((c) => c.body.sender_action === "typing_on")).toBe(true);
    const reply = api.calls.find((c) => c.body.message !== undefined);
    expect(reply?.body).toEqual({ recipient: { id: PSID }, messaging_type: "RESPONSE", message: { text: "স্বাগতম! কীভাবে সাহায্য করতে পারি?" } });
    expect(sent()).toHaveLength(1);
  });

  it("ignores echoes, receipts and other pages, and maps postbacks", () => {
    const parse = (body: string) => toMessengerInbound(JSON.parse(body), PAGE);
    expect(parse(event({ message: { mid: "m", text: "from the page", is_echo: true } }))).toEqual([]);
    expect(parse(event({ delivery: { mids: ["m"] } }))).toEqual([]);
    expect(parse(event({ read: { watermark: 1 } }))).toEqual([]);
    expect(parse(event({ message: { mid: "m", text: "hi" } }, "9999"))).toEqual([]);
    expect(parse(event({ postback: { title: "Get Started", payload: "GET_STARTED" } }))).toEqual([{ conversationId: PSID, senderId: PSID, text: "/start" }]);
    expect(parse(event({ postback: { title: "অর্ডার ট্র্যাক করুন", payload: "TRACK" } }))).toEqual([{ conversationId: PSID, senderId: PSID, text: "অর্ডার ট্র্যাক করুন" }]);
    // Attachments without text reach the router without text, which answers with the "text only" notice.
    expect(parse(event({ message: { mid: "m", attachments: [{ type: "image" }] } }))).toEqual([{ conversationId: PSID, senderId: PSID }]);
    expect(toMessengerInbound({ object: "instagram", entry: [] })).toEqual([]);
  });

  it("splits long replies at Messenger's 2000-character limit and respects the allowlist", async () => {
    const long = "ক".repeat(2500);
    const { router, post, sent } = setup({ script: [{ content: long }] });
    await post(event({ message: { mid: "m1", text: "লম্বা উত্তর দাও" } }));
    await router.drain();
    expect(sent().map((t) => t.length)).toEqual([2000, 500]);

    const stranger = setup({ allowed: ["1"] });
    await stranger.post(event({ message: { mid: "m2", text: "hi" } }));
    await stranger.router.drain();
    expect(stranger.sent()).toHaveLength(1); // the localised "not allowed" notice, not an agent reply
  });

  it("sends operator replies with the HUMAN_AGENT tag when asked", async () => {
    const api = fakeFetch(() => ({}));
    const messenger = new MessengerApi({ pageAccessToken: "t", graphApiVersion: "v21.0", fetch: api.fn, baseUrl: "https://graph.test" });
    await messenger.sendText(PSID, "Operator here", { humanAgent: true });
    expect(api.calls[0]?.body).toEqual({ recipient: { id: PSID }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT", message: { text: "Operator here" } });
  });
});
