/**
 * Remote conversation (`contextId`) per BanglaClaw session, for one agent. Kept in memory and bounded: after a
 * restart, or once a session falls out, the next call simply starts a new remote conversation.
 */
export class Conversations {
  readonly #entries = new Map<string, string>();

  constructor(private readonly max = 10_000) {}

  get(sessionId: string): string | undefined {
    return this.#entries.get(sessionId);
  }

  set(sessionId: string, contextId: string): void {
    // Re-inserting keeps the map in least-recently-used order.
    this.#entries.delete(sessionId);
    this.#entries.set(sessionId, contextId);
    if (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done !== true) this.#entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}
