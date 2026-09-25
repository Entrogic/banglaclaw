import { Hono } from "hono";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { audioFilename, createLogger, type AudioInput, type Logger } from "@banglaclaw/shared";
import type { ChannelAdapter, ChannelRouter, InboundMessage } from "./router.js";

const UpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({ id: z.number(), type: z.string() }),
      from: z.object({ id: z.number(), first_name: z.string().optional(), username: z.string().optional(), is_bot: z.boolean().optional() }).optional(),
      text: z.string().optional(),
      /** Voice note (recorded in Telegram) or an audio file. */
      voice: z.object({ file_id: z.string(), duration: z.number(), mime_type: z.string().optional(), file_size: z.number().optional() }).optional(),
      audio: z.object({ file_id: z.string(), duration: z.number(), mime_type: z.string().optional(), file_size: z.number().optional() }).optional(),
    })
    .optional(),
});

/** Bots may download files up to 20 MB (Bot API limit). */
const MAX_TELEGRAM_FILE_BYTES = 20 * 1024 * 1024;
export type TelegramUpdate = z.infer<typeof UpdateSchema>;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    description: string,
  ) {
    super(`Telegram ${method} failed (${status}): ${description}`);
    this.name = "TelegramApiError";
  }
}

/** Minimal Telegram Bot API client over fetch (no SDK dependency). */
export class TelegramApi {
  readonly #token: string;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;

  constructor(token: string, options: { fetch?: FetchLike; baseUrl?: string } = {}) {
    if (!/^\d+:[\w-]{20,}$/.test(token)) throw new Error("TELEGRAM_BOT_TOKEN does not look like a bot token (<id>:<secret>)");
    this.#token = token;
    this.#fetch = options.fetch ?? fetch;
    this.#baseUrl = options.baseUrl ?? "https://api.telegram.org";
  }

  async call<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}/bot${this.#token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        ...(signal !== undefined && { signal }),
      });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      // Surface the network cause (ENOTFOUND, ECONNREFUSED, …) instead of a bare "fetch failed"; never the token URL.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
      const code = cause !== undefined && "code" in cause ? String(cause.code) : undefined;
      throw new TelegramApiError(method, 0, `cannot reach ${new URL(this.#baseUrl).host}${code !== undefined ? ` (${code})` : cause !== undefined ? ` (${cause.message})` : ""}`);
    }
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || body.ok !== true) throw new TelegramApiError(method, res.status, body.description ?? res.statusText);
    return body.result as T;
  }

  getMe() {
    return this.call<{ id: number; username: string; first_name: string }>("getMe");
  }

  async getUpdates(offset: number | undefined, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    const raw = await this.call<unknown[]>(
      "getUpdates",
      { timeout: timeoutSeconds, allowed_updates: ["message"], ...(offset !== undefined && { offset }) },
      signal,
    );
    return raw.flatMap((u) => {
      const parsed = UpdateSchema.safeParse(u);
      return parsed.success ? [parsed.data] : [];
    });
  }

  sendMessage(chatId: string, text: string) {
    // Plain text (no parse_mode) so model output never breaks on Markdown escaping rules.
    return this.call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  }

  /** Downloads a file by id (getFile, then the file URL). */
  async downloadFile(fileId: string, mimeType: string): Promise<AudioInput> {
    const file = z.object({ file_path: z.string(), file_size: z.number().optional() }).parse(await this.call<unknown>("getFile", { file_id: fileId }));
    if (file.file_size !== undefined && file.file_size > MAX_TELEGRAM_FILE_BYTES) throw new Error("file is larger than 20 MB");
    const res = await this.#fetch(`${this.#baseUrl}/file/bot${this.#token}/${file.file_path}`);
    if (!res.ok) throw new TelegramApiError("getFile", res.status, "download failed");
    return { data: new Uint8Array(await res.arrayBuffer()), mimeType, filename: audioFilename(mimeType) };
  }

  sendChatAction(chatId: string, action = "typing") {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }

  setWebhook(url: string, secretToken: string) {
    return this.call("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message"], drop_pending_updates: false });
  }

  deleteWebhook() {
    return this.call("deleteWebhook", { drop_pending_updates: false });
  }
}

/**
 * Normalises a Telegram update. Only private chats with a human sender are handled. With `api`,
 * voice notes and audio files carry a lazy download for transcription.
 */
export function toInbound(update: TelegramUpdate, api?: TelegramApi): InboundMessage | undefined {
  const m = update.message;
  if (m === undefined || m.from === undefined || m.from.is_bot === true || m.chat.type !== "private") return undefined;
  const sound = m.voice ?? m.audio;
  return {
    conversationId: String(m.chat.id),
    senderId: String(m.from.id),
    ...(m.from.username !== undefined || m.from.first_name !== undefined ? { senderName: m.from.username ?? m.from.first_name } : {}),
    ...(m.text !== undefined && { text: m.text }),
    ...(sound !== undefined &&
      api !== undefined && {
        audio: { durationSeconds: sound.duration, download: () => api.downloadFile(sound.file_id, sound.mime_type ?? "audio/ogg") },
      }),
  };
}

export const TELEGRAM_WEBHOOK_PATH = "/channels/telegram/webhook";

export interface TelegramChannelOptions {
  api: TelegramApi;
  router: ChannelRouter;
  logger?: Logger;
  /** Long-poll timeout (seconds). */
  pollTimeoutSeconds?: number;
}

/** Telegram channel: long polling (dev) or webhook (production, mounted on the gateway). */
export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";
  readonly maxMessageLength = 4096;
  readonly #options: TelegramChannelOptions;
  readonly #logger: Logger;
  #poller: AbortController | undefined;
  #polling: Promise<void> | undefined;

  constructor(options: TelegramChannelOptions) {
    this.#options = options;
    this.#logger = (options.logger ?? createLogger({ level: "warn" })).child({ channel: "telegram" });
  }

  async send(conversationId: string, text: string): Promise<void> {
    await this.#options.api.sendMessage(conversationId, text);
  }

  async typing(conversationId: string): Promise<void> {
    await this.#options.api.sendChatAction(conversationId);
  }

  /** Dispatches one update without awaiting the agent (webhooks must answer fast). */
  dispatch(update: TelegramUpdate): void {
    const inbound = toInbound(update, this.#options.api);
    if (inbound === undefined) {
      this.#logger.debug("ignoring unsupported update", { updateId: update.update_id });
      return;
    }
    void this.#options.router.handle(this, inbound);
  }

  /** Starts long polling. Removes any webhook first (Telegram rejects getUpdates while one is set). */
  async startPolling(): Promise<void> {
    if (this.#poller !== undefined) return;
    await this.#options.api.deleteWebhook();
    const controller = new AbortController();
    this.#poller = controller;
    this.#polling = this.#pollLoop(controller.signal);
  }

  async stopPolling(): Promise<void> {
    this.#poller?.abort();
    await this.#polling;
    this.#poller = undefined;
    this.#polling = undefined;
  }

  async #pollLoop(signal: AbortSignal): Promise<void> {
    let offset: number | undefined;
    let backoffMs = 1_000;
    while (!signal.aborted) {
      try {
        const updates = await this.#options.api.getUpdates(offset, this.#options.pollTimeoutSeconds ?? 30, signal);
        backoffMs = 1_000;
        for (const update of updates) {
          offset = update.update_id + 1;
          this.dispatch(update);
        }
      } catch (error) {
        if (signal.aborted) break;
        this.#logger.warn("telegram polling failed; retrying", { error, backoffMs });
        await sleep(backoffMs, signal);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  /** Registers the webhook with Telegram. */
  async registerWebhook(publicBaseUrl: string, secretToken: string): Promise<string> {
    const url = new URL(TELEGRAM_WEBHOOK_PATH, publicBaseUrl).toString();
    await this.#options.api.setWebhook(url, secretToken);
    return url;
  }

  /** Hono sub-app for POST /channels/telegram/webhook, verified by the secret-token header. */
  webhookApp(secretToken: string): Hono {
    const app = new Hono();
    const expected = Buffer.from(secretToken);
    app.post(TELEGRAM_WEBHOOK_PATH, async (c) => {
      const given = Buffer.from(c.req.header("x-telegram-bot-api-secret-token") ?? "");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return c.json({ ok: false }, 401);
      const parsed = UpdateSchema.safeParse(await c.req.json().catch(() => undefined));
      if (parsed.success) this.dispatch(parsed.data);
      // Always 200 for authenticated requests so Telegram doesn't retry malformed updates forever.
      return c.json({ ok: true });
    });
    return app;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
