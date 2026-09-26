import { AgentRunError, detectLanguage, type AgentRuntime } from "@entrogic-net/agent";
import type { SessionStore } from "@entrogic-net/session";
import { RateLimiter, createLogger, type AudioInput, type Logger, type Transcriber } from "@entrogic-net/shared";
import { notice } from "./messages.js";
import { LiveReply, type EditableReplies } from "./stream.js";
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
  /** A voice note or audio file; downloaded only when voice is enabled and the sender passed the checks. */
  audio?: InboundAudio;
}

export interface InboundAudio {
  /** Length reported by the platform, when it does. */
  durationSeconds?: number;
  download(): Promise<AudioInput>;
}

/** Voice notes (docs/11): transcribed, then answered like text. */
export interface VoiceOptions {
  transcriber: Transcriber;
  /** Recogniser language hint, e.g. "bn"; undefined lets it detect. */
  language?: string;
  maxSeconds: number;
  /** Largest audio accepted after download (OpenAI's limit is 25 MB). */
  maxBytes?: number;
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
  /** Present when the platform can edit sent messages: replies are then streamed live (docs/11). */
  readonly editable?: EditableReplies;
}

/** Live replies on platforms that can edit messages. */
export interface LiveReplySettings {
  /** Minimum milliseconds between edits of one reply. */
  intervalMs: number;
  /** Characters collected before the first message is posted. */
  minChars: number;
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
  voice?: VoiceOptions;
  /** Stream replies by editing messages where the adapter supports it; false turns it off. */
  liveReplies?: LiveReplySettings | false;
}

const TYPING_INTERVAL_MS = 4_000;
const DEFAULT_LIVE_REPLIES: LiveReplySettings = { intervalMs: 1_500, minChars: 30 };
const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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
    let text = message.text?.trim() ?? "";
    // Messages without text (voice, photos) get Bangla notices until a transcript says otherwise.
    let language = text === "" ? "bn" : detectLanguage(text);

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
    const voice = this.#options.voice;
    const spoken = text === "" && message.audio !== undefined && voice !== undefined;
    if (text === "" && !spoken) return this.#reply(adapter, message.conversationId, notice(voice !== undefined ? "textOrVoice" : "textOnly", "bn"));

    const { sessions, runtime, agentName } = this.#options;
    if (!spoken) {
      const command = text.split(/\s+/)[0]?.toLowerCase().replace(/@.*$/, "");
      if (command === "/start") return this.#reply(adapter, message.conversationId, notice("welcome", "bn"));
      if (command === "/new" || command === "/reset") {
        const current = await sessions.findByExternalId(adapter.name, message.conversationId);
        if (current !== undefined) await sessions.detachExternalId(current.id);
        return this.#reply(adapter, message.conversationId, notice("newSession", language));
      }
    }

    const typing = adapter.typing?.bind(adapter);
    let timer: NodeJS.Timeout | undefined;
    let live: LiveReply | undefined;
    if (typing !== undefined) {
      const tick = () => void typing(message.conversationId).catch(() => {});
      tick();
      timer = setInterval(tick, TYPING_INTERVAL_MS);
    }
    try {
      if (spoken && message.audio !== undefined && voice !== undefined) {
        const transcript = await this.#transcribe(message.audio, voice, log);
        if (transcript.kind !== "ok") return await this.#reply(adapter, message.conversationId, notice(transcript.kind === "tooLong" ? "voiceTooLong" : "voiceFailed", "bn"));
        text = transcript.text;
        language = detectLanguage(text);
      }
      const session =
        (await sessions.findByExternalId(adapter.name, message.conversationId)) ??
        (await sessions.create({ channel: adapter.name, externalId: message.conversationId, agentId: agentName }));
      const settings = this.#options.liveReplies === false ? undefined : (this.#options.liveReplies ?? DEFAULT_LIVE_REPLIES);
      live =
        adapter.editable !== undefined && settings !== undefined
          ? new LiveReply(adapter.editable, message.conversationId, { ...settings, maxMessageLength: adapter.maxMessageLength }, log, () => clearInterval(timer))
          : undefined;
      const stream = live;
      const record = await runtime.run(text, {
        sessionId: session.id,
        ...(stream !== undefined && {
          onEvent: (e) => {
            if (e.type === "token") stream.token(e.text);
            else if (e.type === "tool_start") stream.toolStarted();
          },
        }),
      });
      // Handed-off sessions: the message is stored for the operator and the bot stays silent.
      if (record.status === "handoff" && record.output === undefined) {
        if (live?.started === true) await this.#finishLive(adapter, message.conversationId, live, undefined);
        return;
      }
      const reply = record.output ?? notice("failed", language);
      if (live !== undefined) await this.#finishLive(adapter, message.conversationId, live, reply);
      else await this.#reply(adapter, message.conversationId, reply);
      log.info("channel reply sent", { runId: record.id, status: record.status, live: live?.started === true });
    } catch (error) {
      log.error("channel run failed", { error: error instanceof AgentRunError ? error.record.error : error });
      if (live?.started === true) await this.#finishLive(adapter, message.conversationId, live, notice("failed", language));
      else await this.#reply(adapter, message.conversationId, notice("failed", language));
    } finally {
      clearInterval(timer);
    }
  }

  /** Settles a live reply on `text` (or on what was streamed), sending anything editing couldn't show. */
  async #finishLive(adapter: ChannelAdapter, conversationId: string, live: LiveReply, text: string | undefined): Promise<void> {
    for (const chunk of await live.finish(text)) await adapter.send(conversationId, chunk);
  }

  async #transcribe(audio: InboundAudio, voice: VoiceOptions, log: Logger): Promise<{ kind: "ok"; text: string } | { kind: "tooLong" | "failed" }> {
    if (audio.durationSeconds !== undefined && audio.durationSeconds > voice.maxSeconds) {
      log.info("voice note too long", { seconds: audio.durationSeconds });
      return { kind: "tooLong" };
    }
    try {
      const input = await audio.download();
      if (input.data.byteLength > (voice.maxBytes ?? DEFAULT_MAX_AUDIO_BYTES)) return { kind: "tooLong" };
      const text = (await voice.transcriber.transcribe(input, voice.language !== undefined ? { language: voice.language } : {})).trim();
      log.info("voice note transcribed", { bytes: input.data.byteLength, chars: text.length });
      return text === "" ? { kind: "failed" } : { kind: "ok", text };
    } catch (error) {
      log.error("voice note transcription failed", { error });
      return { kind: "failed" };
    }
  }
}
