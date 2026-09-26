import type { Hono } from "hono";
import type { AgentRuntime } from "@entrogic-net/agent";
import { ChannelRouter, MessengerApi, MessengerChannel, TelegramApi, TelegramChannel, WhatsAppApi, WhatsAppChannel, splitMessage } from "@entrogic-net/channels";
import { OpenAICompatibleTranscriber } from "@entrogic-net/providers";
import type { Deliver, SessionStore } from "@entrogic-net/session";
import { ConfigError, type LoadedConfig, type Logger, type Transcriber } from "@entrogic-net/shared";

export interface ChannelSetup {
  routes: Hono[];
  /** Human-readable status lines for the serve banner. */
  summary: string[];
  warnings: string[];
  /** Called once the gateway is listening (starts polling / registers webhooks). */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Delivers operator replies (human handoff) to Telegram/WhatsApp users using the channel secrets.
 * Stateless HTTP, so it works from `banglaclaw handoff reply` as well as the gateway.
 */
export function createDeliver(loaded: LoadedConfig, logger: Logger): Deliver {
  const { config, secrets } = loaded;
  const telegram = config.channels.telegram.enabled && secrets.telegramBotToken !== undefined ? new TelegramApi(secrets.telegramBotToken) : undefined;
  const wa = config.channels.whatsapp;
  const whatsapp =
    wa.enabled && wa.phoneNumberId !== undefined && secrets.whatsappAccessToken !== undefined
      ? new WhatsAppApi({ accessToken: secrets.whatsappAccessToken, phoneNumberId: wa.phoneNumberId, graphApiVersion: wa.graphApiVersion })
      : undefined;
  const fb = config.channels.messenger;
  const messenger =
    fb.enabled && secrets.messengerPageAccessToken !== undefined ? new MessengerApi({ pageAccessToken: secrets.messengerPageAccessToken, graphApiVersion: fb.graphApiVersion }) : undefined;
  return async (session, text) => {
    if (session.externalId === undefined) return false;
    try {
      if (session.channel === "telegram" && telegram !== undefined) {
        for (const chunk of splitMessage(text, 4096)) await telegram.sendMessage(session.externalId, chunk);
        return true;
      }
      if (session.channel === "whatsapp" && whatsapp !== undefined) {
        for (const chunk of splitMessage(text, 4096)) await whatsapp.sendText(session.externalId, chunk);
        return true;
      }
      if (session.channel === "messenger" && messenger !== undefined) {
        for (const chunk of splitMessage(text, 2000)) await messenger.sendText(session.externalId, chunk, { humanAgent: fb.humanAgentTag });
        return true;
      }
    } catch (error) {
      logger.error("operator reply delivery failed", { channel: session.channel, error });
    }
    return false;
  };
}

/** Speech-to-text for voice notes (config `voice`), or undefined when voice is off. Throws ConfigError without a key. */
export function createTranscriber(loaded: LoadedConfig): Transcriber | undefined {
  const { config, secrets } = loaded;
  if (!config.voice.enabled) return undefined;
  const apiKey = secrets.transcriptionApiKey ?? secrets.openaiApiKey;
  if (apiKey === undefined && config.voice.baseUrl === undefined) {
    throw new ConfigError("voice.enabled needs OPENAI_API_KEY or TRANSCRIPTION_API_KEY (or voice.baseUrl for a keyless local server)");
  }
  return new OpenAICompatibleTranscriber({
    model: config.voice.model,
    ...(apiKey !== undefined && { apiKey }),
    ...(config.voice.baseUrl !== undefined && { baseUrl: config.voice.baseUrl }),
  });
}

/** Builds the enabled channels from config (docs/11). Throws ConfigError for missing secrets. */
export function setupChannels(loaded: LoadedConfig, runtime: AgentRuntime, sessions: SessionStore, logger: Logger): ChannelSetup {
  const { config, secrets } = loaded;
  const routes: Hono[] = [];
  const summary: string[] = [];
  const warnings: string[] = [];
  const starters: (() => Promise<void>)[] = [];
  const stoppers: (() => Promise<void>)[] = [];
  const routers: ChannelRouter[] = [];

  const channelsOn = config.channels.telegram.enabled || config.channels.whatsapp.enabled || config.channels.messenger.enabled;
  const transcriber = channelsOn ? createTranscriber(loaded) : undefined;
  const voice =
    transcriber === undefined
      ? undefined
      : { transcriber, maxSeconds: config.voice.maxSeconds, ...(config.voice.language !== "auto" && { language: config.voice.language }) };
  if (voice !== undefined) summary.push(`voice notes: ${transcriber?.id ?? ""} (up to ${config.voice.maxSeconds} s)`);

  const makeRouter = (access: "allowlist" | "open", allowed: string[], rateLimitPerMinute: number, name: string) => {
    if (access === "allowlist" && allowed.length === 0) {
      warnings.push(`${name}: allowlist is empty, so nobody will be answered. Message the bot, copy "senderId" from the gateway log, and add it to the allowlist.`);
    }
    const router = new ChannelRouter({ runtime, sessions, agentName: config.agent.name, access: { access, allowed }, rateLimitPerMinute, logger, ...(voice !== undefined && { voice }) });
    routers.push(router);
    return router;
  };

  const tg = config.channels.telegram;
  if (tg.enabled) {
    if (secrets.telegramBotToken === undefined) throw new ConfigError("channels.telegram is enabled but TELEGRAM_BOT_TOKEN is not set");
    const api = new TelegramApi(secrets.telegramBotToken);
    const channel = new TelegramChannel({ api, router: makeRouter(tg.access, tg.allowedUserIds, tg.rateLimitPerMinute, "telegram"), logger });
    if (tg.mode === "polling") {
      starters.push(async () => {
        const me = await api.getMe();
        await channel.startPolling();
        summary.push(`telegram @${me.username}: long polling`);
      });
      stoppers.push(() => channel.stopPolling());
    } else {
      if (tg.webhookUrl === undefined) throw new ConfigError("channels.telegram.mode is webhook but channels.telegram.webhookUrl is not set");
      if (secrets.telegramWebhookSecret === undefined || !/^[A-Za-z0-9_-]{16,256}$/.test(secrets.telegramWebhookSecret)) {
        throw new ConfigError("Telegram webhook mode needs TELEGRAM_WEBHOOK_SECRET (16-256 chars of A-Z a-z 0-9 _ -)");
      }
      const secret = secrets.telegramWebhookSecret;
      const webhookUrl = tg.webhookUrl;
      routes.push(channel.webhookApp(secret));
      starters.push(async () => {
        const me = await api.getMe();
        const url = await channel.registerWebhook(webhookUrl, secret);
        summary.push(`telegram @${me.username}: webhook ${url}`);
      });
    }
  }

  const wa = config.channels.whatsapp;
  if (wa.enabled) {
    const missing = [
      wa.phoneNumberId === undefined && "channels.whatsapp.phoneNumberId",
      secrets.whatsappAccessToken === undefined && "WHATSAPP_ACCESS_TOKEN",
      secrets.whatsappAppSecret === undefined && "WHATSAPP_APP_SECRET",
      secrets.whatsappVerifyToken === undefined && "WHATSAPP_VERIFY_TOKEN",
    ].filter((m): m is string => m !== false);
    if (missing.length > 0) throw new ConfigError(`channels.whatsapp is enabled but missing: ${missing.join(", ")}`);
    const phoneNumberId = wa.phoneNumberId as string;
    const channel = new WhatsAppChannel({
      api: new WhatsAppApi({ accessToken: secrets.whatsappAccessToken as string, phoneNumberId, graphApiVersion: wa.graphApiVersion }),
      router: makeRouter(wa.access, wa.allowedNumbers, wa.rateLimitPerMinute, "whatsapp"),
      appSecret: secrets.whatsappAppSecret as string,
      verifyToken: secrets.whatsappVerifyToken as string,
      phoneNumberId,
      logger,
    });
    routes.push(channel.webhookApp());
    summary.push("whatsapp: webhook at /channels/whatsapp/webhook (configure it in the Meta app dashboard)");
  }

  const fb = config.channels.messenger;
  if (fb.enabled) {
    const missing = [
      secrets.messengerPageAccessToken === undefined && "MESSENGER_PAGE_ACCESS_TOKEN",
      secrets.messengerAppSecret === undefined && "MESSENGER_APP_SECRET",
      secrets.messengerVerifyToken === undefined && "MESSENGER_VERIFY_TOKEN",
    ].filter((m): m is string => m !== false);
    if (missing.length > 0) throw new ConfigError(`channels.messenger is enabled but missing: ${missing.join(", ")}`);
    const channel = new MessengerChannel({
      api: new MessengerApi({ pageAccessToken: secrets.messengerPageAccessToken as string, graphApiVersion: fb.graphApiVersion }),
      router: makeRouter(fb.access, fb.allowedUserIds, fb.rateLimitPerMinute, "messenger"),
      appSecret: secrets.messengerAppSecret as string,
      verifyToken: secrets.messengerVerifyToken as string,
      ...(fb.pageId !== undefined && { pageId: fb.pageId }),
      logger,
    });
    routes.push(channel.webhookApp());
    summary.push("messenger: webhook at /channels/messenger/webhook (subscribe the page to messages and messaging_postbacks)");
  }

  return {
    routes,
    summary,
    warnings,
    start: async () => {
      for (const start of starters) await start();
    },
    stop: async () => {
      await Promise.allSettled(stoppers.map((s) => s()));
      await Promise.allSettled(routers.map((r) => r.drain()));
    },
  };
}
