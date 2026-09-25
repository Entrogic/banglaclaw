/** Something that happened to a session outside a run, pushed to subscribed API clients (docs/18). */
export type SessionEvent =
  | { type: "operator_message"; sessionId: string; text: string; at: string }
  | { type: "handoff_released"; sessionId: string; at: string };

type Listener = (event: SessionEvent) => void;

/**
 * In-process pub/sub keyed by session id. Subscribers are WebSocket connections and SSE streams
 * of this gateway process; several gateway instances would need a shared bus (docs/20).
 */
export class SessionEvents {
  readonly #listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.#listeners.get(sessionId);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      const current = this.#listeners.get(sessionId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) this.#listeners.delete(sessionId);
    };
  }

  /** Returns how many subscribers received the event. A throwing listener never affects the others. */
  publish(event: SessionEvent): number {
    const set = this.#listeners.get(event.sessionId);
    if (set === undefined) return 0;
    let delivered = 0;
    for (const listener of [...set]) {
      try {
        listener(event);
        delivered++;
      } catch {
        // A broken connection is cleaned up by its own close handler.
      }
    }
    return delivered;
  }

  subscribers(sessionId: string): number {
    return this.#listeners.get(sessionId)?.size ?? 0;
  }
}
