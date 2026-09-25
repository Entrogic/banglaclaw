import { AgentRunError, detectLanguage, type AgentRuntime } from "@banglaclaw/agent";
import type { SessionStore } from "@banglaclaw/session";
import { RateLimiter, createLogger, type Logger } from "@banglaclaw/shared";
import { notice } from "./messages.js";
import { splitMessage } from "./text.js";

/** A message normalised from any platform (docs/11). */
export interface InboundMessage {
  /** Conversation on the platform (Telegram chat id, WhatsApp number). Sessions are keyed by it. */
  conversationId: string;
  /** Platform user id, checked against the allowlist. */
  senderId: string;
  senderName?: string;
  /** undefined for non-text messages (photos, voice, stickers…). */
  text?: string;
}

/** Outbound side of a platform adapter. */
export interface ChannelAdapter {
  /** Session channel name, e.g. "telegram". */
  readonly name: string;
  /** Platform message length limit. */
  readonly maxMessageLength: number;
  send(conversationId: string, text: string): Promise<void>;
  /** Optional "typing…" indicator. */
  typing?(conversationId: string): Promise<void>;
}

export interface AccessPolicy {
  access: "allowlist" | "open";
  allowed: readonly string[];
}

export interface ChannelRouterOptions {
  runtime: AgentRuntime;
  sessions: SessionStore;
  agentName: string;
  access: AccessPolicy;
  rateLimitPerMinute: number;
  logger?: Logger;
}

const TYPING_INTERVAL_MS = 4_000;

/**
 * Turns platform messages into agent runs (docs/11): access check → rate limit → commands
 * (/start, /new) → session by conversation → run → reply. Messages of one conversation are
 * processed strictly in order; different conversations run concurrently. The channel holds no
 * reasoning logic (ADR-0005).
 */
export class ChannelRouter {
  readonly #options: ChannelRouterOptions;
  readonly #logger: Logger;
  readonly #rate: RateLimiter;
  readonly #allowed: ReadonlySet<string>;
  readonly #queues = new Map<string, Promise<void>>();

  constructor(options: ChannelRouterOptions) {
    this.#options = options;
    this.#logger = options.logger ?? createLogger({ level: "warn" });
    this.#rate = new RateLimiter(options.rateLimitPerMinute);
    this.#allowed = new Set(options.access.allowed);
  }

  isAllowed(senderId: string): boolean {
    return this.#options.access.access === "open" || this.#allowed.has(senderId);
  }

  /** Queues a message; resolves when it has been answered. Never throws. */
  handle(adapter: ChannelAdapter, message: InboundMessage): Promise<void> {
    const key = `${adapter.name}:${message.conversationId}`;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const next = previous.then(() => this.#process(adapter, message)).catch((error: unknown) => {
      this.#logger.error("channel message failed", { channel: adapter.name, conversationId: message.conversationId, error });
    });
    this.#queues.set(key, next);
    void next.finally(() => {
      if (this.#queues.get(key) === next) this.#queues.delete(key);
    });
    return next;
  }

  /** Waits for all queued messages (graceful shutdown). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.#queues.values()]);
  }

  async #reply(adapter: ChannelAdapter, conversationId: string, text: string): Promise<void> {
    for (const chunk of splitMessage(text, adapter.maxMessageLength)) await adapter.send(conversationId, chunk);
  }

  async #process(adapter: ChannelAdapter, message: InboundMessage): Promise<void> {
    const log = this.#logger.child({ channel: adapter.name, conversationId: message.conversationId, senderId: message.senderId });
    const text = message.text?.trim() ?? "";
    const language = detectLanguage(text);

    if (!this.isAllowed(message.senderId)) {
      log.warn("message from sender not in allowlist");
      if (this.#rate.take(`denied:${adapter.name}:${message.senderId}`).ok) {
        await this.#reply(adapter, message.conversationId, notice("notAllowed", language));
      }
      return;
    }
    if (!this.#rate.take(`${adapter.name}:${message.conversationId}`).ok) {
      log.warn("channel rate limit exceeded");
      return this.#reply(adapter, message.conversationId, notice("rateLimited", language));
    }
    if (text === "") return this.#reply(adapter, message.conversationId, notice("textOnly", "bn"));

    const { sessions, runtime, agentName } = this.#options;
    const command = text.split(/\s+/)[0]?.toLowerCase().replace(/@.*$/, "");
    if (command === "/start") return this.#reply(adapter, message.conversationId, notice("welcome", "bn"));
    if (command === "/new" || command === "/reset") {
      const current = await sessions.findByExternalId(adapter.name, message.conversationId);
      if (current !== undefined) await sessions.detachExternalId(current.id);
      return this.#reply(adapter, message.conversationId, notice("newSession", language));
    }

    const session =
      (await sessions.findByExternalId(adapter.name, message.conversationId)) ??
      (await sessions.create({ channel: adapter.name, externalId: message.conversationId, agentId: agentName }));

    const typing = adapter.typing?.bind(adapter);
    let timer: NodeJS.Timeout | undefined;
    if (typing !== undefined) {
      const tick = () => void typing(message.conversationId).catch(() => {});
      tick();
      timer = setInterval(tick, TYPING_INTERVAL_MS);
    }
    try {
      const record = await runtime.run(text, { sessionId: session.id });
      // Handed-off sessions: the message is stored for the operator and the bot stays silent.
      if (record.status === "handoff" && record.output === undefined) return;
      await this.#reply(adapter, message.conversationId, record.output ?? notice("failed", language));
      log.info("channel reply sent", { runId: record.id, status: record.status });
    } catch (error) {
      log.error("channel run failed", { error: error instanceof AgentRunError ? error.record.error : error });
      await this.#reply(adapter, message.conversationId, notice("failed", language));
    } finally {
      clearInterval(timer);
    }
  }
}
