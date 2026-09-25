import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WhatsAppApi, WhatsAppChannel, verifySignature } from "../src/index.js";
import { fakeFetch, makeRouter } from "./helpers.js";

const SECRET = "app-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const payload = (from: string, text: string | undefined, phoneNumberId = "1098") =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: from, profile: { name: "Karim" } }],
      messages: [{ from, id: "wamid.1", type: text === undefined ? "image" : "text", ...(text !== undefined && { text: { body: text } }) }],
    } }] }],
  });

function setup() {
  const { router } = makeRouter({ access: { access: "allowlist", allowed: ["8801700000000"] } });
  const api = fakeFetch(() => ({ messages: [{ id: "wamid.out" }] }));
  const channel = new WhatsAppChannel({
    api: new WhatsAppApi({ accessToken: "tok", phoneNumberId: "1098", graphApiVersion: "v21.0", fetch: api.fn, baseUrl: "https://graph.test" }),
    router, appSecret: SECRET, verifyToken: "verify-me", phoneNumberId: "1098",
  });
  return { app: channel.webhookApp(), api, router };
}

describe("WhatsApp", () => {
  it("verifies signatures", () => {
    expect(verifySignature("{}", sign("{}"), SECRET)).toBe(true);
    expect(verifySignature("{}", sign("{ }"), SECRET)).toBe(false);
    expect(verifySignature("{}", undefined, SECRET)).toBe(false);
    expect(verifySignature("{}", "sha1=abc", SECRET)).toBe(false);
  });

  it("completes the webhook verification handshake", async () => {
    const { app } = setup();
    const ok = await app.request("/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345");
    expect(await ok.text()).toBe("12345");
    expect((await app.request("/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1")).status).toBe(403);
  });

  it("answers signed text messages and rejects unsigned ones", async () => {
    const { app, api, router } = setup();
    const post = (body: string, signature?: string) =>
      app.request("/channels/whatsapp/webhook", { method: "POST", headers: { "Content-Type": "application/json", ...(signature !== undefined && { "X-Hub-Signature-256": signature }) }, body });

    expect((await post(payload("8801700000000", "hi"))).status).toBe(401);
    expect((await post(payload("8801700000000", "hi"), sign("tampered"))).status).toBe(401);

    const body = payload("8801700000000", "হ্যালো");
    expect((await post(body, sign(body))).status).toBe(200);
    const other = payload("8801700000000", "wrong number", "9999");
    expect((await post(other, sign(other))).status).toBe(200);
    await router.drain();

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url).toBe("https://graph.test/v21.0/1098/messages");
    expect(api.calls[0]?.body).toMatchObject({ messaging_product: "whatsapp", to: "8801700000000", type: "text", text: { body: "reply" } });
  });
});
