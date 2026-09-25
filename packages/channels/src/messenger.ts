import { Hono } from "hono";
import { z } from "zod";
import { createLogger, type Logger } from "@banglaclaw/shared";
import { verifyHandshake, verifySignature } from "./meta.js";
import type { ChannelAdapter, ChannelRouter, InboundMessage } from "./router.js";
import type { FetchLike } from "./telegram.js";

const MessagingSchema = z.object({
  sender: z.object({ id: z.string() }),
  recipient: z.object({ id: z.string() }),
  message: z
    .object({
      mid: z.string().optional(),
      text: z.string().optional(),
      is_echo: z.boolean().optional(),
      attachments: z.array(z.unknown()).optional(),
      quick_reply: z.object({ payload: z.string() }).optional(),
    })
    .optional(),
  postback: z.object({ title: z.string().optional(), payload: z.string().optional() }).optional(),
});

const WebhookSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ id: z.string(), messaging: z.array(MessagingSchema).optional() })),
});
export type MessengerWebhook = z.infer<typeof WebhookSchema>;

/** Postback payload of the page's "Get Started" button; answered like /start. */
export const GET_STARTED_PAYLOAD = "GET_STARTED";

export class MessengerApiError extends Error {
  constructor(status: number, detail: string) {
    super(`Messenger API request failed (${status}): ${detail}`);
    this.name = "MessengerApiError";
  }
}

/** Minimal Messenger Send API client (text messages and typing indicators). */
export class MessengerApi {
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;

  constructor(private readonly options: { pageAccessToken: string; graphApiVersion: string; fetch?: FetchLike; baseUrl?: string }) {
    this.#fetch = options.fetch ?? fetch;
    this.#baseUrl = options.baseUrl ?? "https://graph.facebook.com";
  }

  /**
   * Sends text to a page-scoped user id (PSID). Replies inside the 24-hour window use RESPONSE;
   * `humanAgent` sends with the HUMAN_AGENT tag, which allows a person to answer for up to 7 days
   * (the app needs Meta's human_agent permission).
   */
  async sendText(psid: string, text: string, options: { humanAgent?: boolean } = {}): Promise<void> {
    await this.#send({
      recipient: { id: psid },
      ...(options.humanAgent === true ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : { messaging_type: "RESPONSE" }),
      message: { text },
    });
  }

  async typing(psid: string): Promise<void> {
    await this.#send({ recipient: { id: psid }, sender_action: "typing_on" });
  }

  /** The page behind the access token (used by `doctor`). */
  async getPage(): Promise<{ id: string; name: string }> {
    const res = await this.#fetch(`${this.#baseUrl}/${this.options.graphApiVersion}/me?fields=id,name`, {
      headers: { Authorization: `Bearer ${this.options.pageAccessToken}` },
    });
    if (!res.ok) throw new MessengerApiError(res.status, (await res.text()).slice(0, 300));
    return z.object({ id: z.string(), name: z.string() }).parse(await res.json());
  }

  async #send(body: Record<string, unknown>): Promise<void> {
    const res = await this.#fetch(`${this.#baseUrl}/${this.options.graphApiVersion}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.pageAccessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new MessengerApiError(res.status, (await res.text()).slice(0, 300));
  }
}

/**
 * Inbound user messages from a Messenger webhook. Echoes of the page's own messages, delivery/read
 * receipts and events for other pages are dropped. Postbacks (buttons) arrive as their title, and
 * the Get Started button as /start.
 */
export function toMessengerInbound(payload: MessengerWebhook, pageId?: string): InboundMessage[] {
  if (payload.object !== "page") return [];
  const out: InboundMessage[] = [];
  for (const entry of payload.entry) {
    if (pageId !== undefined && entry.id !== pageId) continue;
    for (const event of entry.messaging ?? []) {
      const psid = event.sender.id;
      if (event.message !== undefined) {
        if (event.message.is_echo === true) continue;
        out.push({ conversationId: psid, senderId: psid, ...(event.message.text !== undefined && event.message.text !== "" && { text: event.message.text }) });
      } else if (event.postback !== undefined) {
        const text = event.postback.payload === GET_STARTED_PAYLOAD ? "/start" : (event.postback.title ?? event.postback.payload);
        if (text !== undefined && text !== "") out.push({ conversationId: psid, senderId: psid, text });
      }
    }
  }
  return out;
}

export const MESSENGER_WEBHOOK_PATH = "/channels/messenger/webhook";

export interface MessengerChannelOptions {
  api: MessengerApi;
  router: ChannelRouter;
  appSecret: string;
  verifyToken: string;
  /** Only answer events for this page (recommended when one app serves several pages). */
  pageId?: string;
  logger?: Logger;
}

/** Facebook Messenger channel (webhook only; needs a public HTTPS URL to the gateway). */
export class MessengerChannel implements ChannelAdapter {
  readonly name = "messenger";
  readonly maxMessageLength = 2000;
  readonly #logger: Logger;

  constructor(private readonly options: MessengerChannelOptions) {
    this.#logger = (options.logger ?? createLogger({ level: "warn" })).child({ channel: "messenger" });
  }

  async send(conversationId: string, text: string): Promise<void> {
    await this.options.api.sendText(conversationId, text);
  }

  async typing(conversationId: string): Promise<void> {
    await this.options.api.typing(conversationId);
  }

  /** Hono sub-app: GET verification handshake and signed POST deliveries. */
  webhookApp(): Hono {
    const app = new Hono();
    const { verifyToken, appSecret, pageId, router } = this.options;

    app.get(MESSENGER_WEBHOOK_PATH, (c) => verifyHandshake(c, verifyToken));

    app.post(MESSENGER_WEBHOOK_PATH, async (c) => {
      const raw = await c.req.text();
      if (!verifySignature(raw, c.req.header("x-hub-signature-256"), appSecret)) {
        this.#logger.warn("rejected Messenger webhook with invalid signature");
        return c.text("Invalid signature", 401);
      }
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return c.text("ok");
      }
      const parsed = WebhookSchema.safeParse(json);
      if (parsed.success) {
        for (const inbound of toMessengerInbound(parsed.data, pageId)) void router.handle(this, inbound);
      }
      // Receipts, echoes and unknown payloads are acknowledged so Meta doesn't retry them.
      return c.text("EVENT_RECEIVED");
    });
    return app;
  }
}
