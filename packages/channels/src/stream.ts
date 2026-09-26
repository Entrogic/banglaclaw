import type { Logger } from "@entrogic-net/shared";
import { splitMessage } from "./text.js";

/** Platforms that can post a message and later replace its text (Telegram). */
export interface EditableReplies {
  /** Posts a message and returns its id. */
  post(conversationId: string, text: string): Promise<string>;
  edit(conversationId: string, messageId: string, text: string): Promise<void>;
  /** Removes a message that the final reply no longer needs. */
  remove?(conversationId: string, messageId: string): Promise<void>;
}

export interface LiveReplyOptions {
  /** Minimum time between edits of the same reply (platform rate limits). */
  intervalMs: number;
  /** Characters needed before the first message is posted, so it never shows a lone word. */
  minChars: number;
  maxMessageLength: number;
}

/** Shown after the text while the reply is still being written. */
const CURSOR = " ▍";

/**
 * Streams one reply into editable platform messages: posts once enough text has arrived, then
 * edits at most every `intervalMs`, spilling into new messages past the length limit. `finish`
 * replaces everything with the authoritative final text. Any platform error stops live updates;
 * `finish` then falls back to plain sends for whatever wasn't delivered.
 */
export class LiveReply {
  readonly #messages: { id: string; shown: string }[] = [];
  #text = "";
  #resetOnNextToken = false;
  #failed = false;
  #timer: NodeJS.Timeout | undefined;
  #lastFlush = 0;
  #flushing: Promise<void> = Promise.resolve();

  constructor(
    readonly editable: EditableReplies,
    readonly conversationId: string,
    readonly options: LiveReplyOptions,
    readonly log: Logger,
    readonly onFirstPost: () => void = () => {},
  ) {}

  /** True once something is visible on the platform. */
  get started(): boolean {
    return this.#messages.length > 0;
  }

  token(text: string): void {
    if (this.#failed) return;
    if (this.#resetOnNextToken) {
      // Text written before a tool call is replaced by what the agent says after it.
      this.#text = "";
      this.#resetOnNextToken = false;
    }
    this.#text += text;
    this.#schedule();
  }

  /** A tool call started: the next text replaces the current draft (same messages are reused). */
  toolStarted(): void {
    if (this.#text !== "") this.#resetOnNextToken = true;
  }

  /**
   * Shows the final reply. Returns the chunks that could not be delivered by editing, which the
   * caller must send normally (all of them when live updates failed before anything was posted).
   */
  async finish(finalText?: string): Promise<string[]> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#flushing;
    const chunks = splitMessage(finalText ?? this.#text, this.options.maxMessageLength);
    if (this.#failed && !this.started) return chunks;
    for (const [i, chunk] of chunks.entries()) {
      const message = this.#messages[i];
      if (message === undefined) return chunks.slice(i);
      if (message.shown === chunk) continue;
      try {
        await this.#edit(message, chunk);
      } catch (error) {
        // The draft stays as it was; the final text from here on goes out as new messages.
        this.log.warn("live reply could not be finalised; sending the rest normally", { error });
        return chunks.slice(i);
      }
    }
    for (const extra of this.#messages.slice(chunks.length)) {
      try {
        if (this.editable.remove !== undefined) await this.editable.remove(this.conversationId, extra.id);
        else await this.#edit(extra, "…");
      } catch (error) {
        this.log.warn("could not remove a leftover live reply message", { error });
      }
    }
    return [];
  }

  #schedule(): void {
    if (this.#timer !== undefined) return;
    if (!this.started && this.#text.trim().length < this.options.minChars) return;
    const wait = Math.max(0, this.#lastFlush + this.options.intervalMs - Date.now());
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#flushing = this.#flushing.then(() => this.#flush());
    }, wait);
  }

  async #flush(): Promise<void> {
    if (this.#failed) return;
    this.#lastFlush = Date.now();
    const limit = this.options.maxMessageLength - CURSOR.length;
    const chunks = splitMessage(this.#text, limit);
    try {
      for (const [i, chunk] of chunks.entries()) {
        const live = i === chunks.length - 1;
        const text = live ? chunk + CURSOR : chunk;
        const message = this.#messages[i];
        if (message === undefined) {
          const id = await this.editable.post(this.conversationId, text);
          const first = this.#messages.length === 0;
          this.#messages.push({ id, shown: text });
          if (first) this.onFirstPost();
        } else if (message.shown !== text) {
          await this.#edit(message, text);
        }
      }
    } catch (error) {
      this.#failed = true;
      this.log.warn("live reply update failed; falling back to a normal reply", { error });
    }
  }

  async #edit(message: { id: string; shown: string }, text: string): Promise<void> {
    await this.editable.edit(this.conversationId, message.id, text);
    message.shown = text;
  }
}
