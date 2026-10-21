/** A remote conversation, and the task in it that is waiting for our answer (`input-required`). */
export interface Conversation {
  contextId: string;
  pendingTaskId?: string;
}

/**
 * Remote conversation per BanglaClaw session, for one agent. Kept in memory and bounded: after a
 * restart, or once a session falls out, the next call simply starts a new remote conversation.
 */
export class Conversations {
  readonly #entries = new Map<string, Conversation>();

  constructor(private readonly max = 10_000) {}

  get(sessionId: string): Conversation | undefined {
    return this.#entries.get(sessionId);
  }

  set(sessionId: string, conversation: Conversation): void {
    // Re-inserting keeps the map in least-recently-used order.
    this.#entries.delete(sessionId);
    this.#entries.set(sessionId, conversation);
    if (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done !== true) this.#entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}
