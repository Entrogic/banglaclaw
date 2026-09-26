import { Hono } from "hono";
import { z } from "zod";
import { audioFilename, createLogger, type AudioInput, type Logger } from "@entrogic-net/shared";
import type { ChannelAdapter, ChannelRouter, InboundMessage } from "./router.js";
import { verifyHandshake, verifySignature } from "./meta.js";
import type { FetchLike } from "./telegram.js";

const WebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).optional(),
            contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
            messages: z
              .array(
                z.object({
                  from: z.string(),
                  id: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                  audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});
export type WhatsAppWebhook = z.infer<typeof WebhookSchema>;

export class WhatsAppApiError extends Error {
  constructor(status: number, detail: string) {
    super(`WhatsApp API request failed (${status}): ${detail}`);
    this.name = "WhatsAppApiError";
  }
}

/** Minimal WhatsApp Cloud API client (send text messages). */
export class WhatsAppApi {
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;

  constructor(
    private readonly options: { accessToken: string; phoneNumberId: string; graphApiVersion: string; fetch?: FetchLike; baseUrl?: string },
  ) {
    this.#fetch = options.fetch ?? fetch;
    this.#baseUrl = options.baseUrl ?? "https://graph.facebook.com";
  }

  async sendText(to: string, body: string): Promise<void> {
    const { graphApiVersion, phoneNumberId, accessToken } = this.options;
    const res = await this.#fetch(`${this.#baseUrl}/${graphApiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
    });
    if (!res.ok) throw new WhatsAppApiError(res.status, (await res.text()).slice(0, 300));
  }

  /** Downloads media (voice notes) by id: the Media API returns a short-lived URL that needs the same token. */
  async downloadMedia(mediaId: string): Promise<AudioInput> {
    const { graphApiVersion, accessToken } = this.options;
    const auth = { Authorization: `Bearer ${accessToken}` };
    const meta = await this.#fetch(`${this.#baseUrl}/${graphApiVersion}/${encodeURIComponent(mediaId)}`, { headers: auth });
    if (!meta.ok) throw new WhatsAppApiError(meta.status, (await meta.text()).slice(0, 300));
    const info = z.object({ url: z.url(), mime_type: z.string(), file_size: z.number().optional() }).parse(await meta.json());
    if (info.file_size !== undefined && info.file_size > 25 * 1024 * 1024) throw new Error("media is larger than 25 MB");
    const res = await this.#fetch(info.url, { headers: auth });
    if (!res.ok) throw new WhatsAppApiError(res.status, "media download failed");
    return { data: new Uint8Array(await res.arrayBuffer()), mimeType: info.mime_type, filename: audioFilename(info.mime_type) };
  }
}

/** With `api`, voice notes and audio messages carry a lazy download for transcription. */
export function toInboundMessages(payload: WhatsAppWebhook, phoneNumberId?: string, api?: WhatsAppApi): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change;
      // Ignore events for other numbers attached to the same app.
      if (phoneNumberId !== undefined && value.metadata !== undefined && value.metadata.phone_number_id !== phoneNumberId) continue;
      for (const m of value.messages ?? []) {
        const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        const audioId = m.type === "audio" ? m.audio?.id : undefined;
        out.push({
          conversationId: m.from,
          senderId: m.from,
          ...(name !== undefined && { senderName: name }),
          ...(m.type === "text" && m.text !== undefined && { text: m.text.body }),
          ...(audioId !== undefined && api !== undefined && { audio: { download: () => api.downloadMedia(audioId) } }),
        });
      }
    }
  }
  return out;
}

export const WHATSAPP_WEBHOOK_PATH = "/channels/whatsapp/webhook";

export interface WhatsAppChannelOptions {
  api: WhatsAppApi;
  router: ChannelRouter;
  appSecret: string;
  verifyToken: string;
  phoneNumberId: string;
  logger?: Logger;
}

/** WhatsApp Cloud API channel (webhook only; needs a public HTTPS URL to the gateway). */
export class WhatsAppChannel implements ChannelAdapter {
  readonly name = "whatsapp";
  readonly maxMessageLength = 4096;
  readonly #logger: Logger;

  constructor(private readonly options: WhatsAppChannelOptions) {
    this.#logger = (options.logger ?? createLogger({ level: "warn" })).child({ channel: "whatsapp" });
  }

  async send(conversationId: string, text: string): Promise<void> {
    await this.options.api.sendText(conversationId, text);
  }

  /** Hono sub-app: GET verification handshake and signed POST deliveries. */
  webhookApp(): Hono {
    const app = new Hono();
    const { verifyToken, appSecret, phoneNumberId, router } = this.options;

    app.get(WHATSAPP_WEBHOOK_PATH, (c) => verifyHandshake(c, verifyToken));

    app.post(WHATSAPP_WEBHOOK_PATH, async (c) => {
      const raw = await c.req.text();
      if (!verifySignature(raw, c.req.header("x-hub-signature-256"), appSecret)) {
        this.#logger.warn("rejected WhatsApp webhook with invalid signature");
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
        for (const inbound of toInboundMessages(parsed.data, phoneNumberId, this.options.api)) void router.handle(this, inbound);
      }
      // Status updates (delivered/read) and unknown payloads are acknowledged so Meta doesn't retry.
      return c.text("ok");
    });
    return app;
  }
}
