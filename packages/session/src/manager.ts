import type { NewSession, Session, SessionStore } from "./session.js";

export interface ResolveSessionInput extends NewSession {
  /** Resume this session id if given (must exist). */
  sessionId?: string;
}

/**
 * Resolves the session for an incoming message (docs/06): an explicit id, an existing
 * channel-native conversation, or a new session.
 */
export class SessionManager {
  constructor(readonly store: SessionStore) {}

  async resolve(input: ResolveSessionInput): Promise<{ session: Session; created: boolean }> {
    if (input.sessionId !== undefined) {
      const session = await this.store.get(input.sessionId);
      if (session === undefined) throw new Error(`Session not found: ${input.sessionId}`);
      return { session, created: false };
    }
    if (input.externalId !== undefined) {
      const existing = await this.store.findByExternalId(input.channel, input.externalId);
      if (existing !== undefined) return { session: existing, created: false };
    }
    const { sessionId: _unused, ...fields } = input;
    return { session: await this.store.create(fields), created: true };
  }
}
