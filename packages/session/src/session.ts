import type { BaseMessage } from "@langchain/core/messages";

/** A conversation on one channel (docs/06). */
export interface Session {
  id: string;
  channel: string;
  /** Channel-native conversation id (Telegram chat id, web session cookie, …). */
  externalId?: string;
  userId?: string;
  agentId: string;
  /** "handoff" while a human operator owns the conversation; the bot does not reply. */
  status: SessionStatus;
  /** Agent that answers the next message (multi-agent); undefined = supervisor/default. */
  activeAgent?: string;
  handoffReason?: string;
  handoffAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionStatus = "active" | "handoff";

export interface SessionPatch {
  status?: SessionStatus;
  /** null clears it. */
  activeAgent?: string | null;
  handoffReason?: string | null;
}

export interface NewSession {
  channel: string;
  externalId?: string;
  userId?: string;
  agentId: string;
}

export interface SessionStore {
  create(input: NewSession): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
  findByExternalId(channel: string, externalId: string): Promise<Session | undefined>;
  /** Most recently updated first. */
  list(options?: { limit?: number; channel?: string; userId?: string; status?: SessionStatus }): Promise<Session[]>;
  /** Updates routing/handoff state. Entering "handoff" stamps handoffAt; leaving clears reason and time. */
  update(id: string, patch: SessionPatch): Promise<Session | undefined>;
  /** Appends messages produced by a run, in order, and bumps updatedAt. */
  appendMessages(sessionId: string, runId: string, messages: BaseMessage[]): Promise<void>;
  /** The most recent `limit` messages, oldest first. */
  recentMessages(sessionId: string, limit: number): Promise<BaseMessage[]>;
  countMessages(sessionId: string): Promise<number>;
  /** Unlinks the channel-native id so the next message from that conversation starts a new session (e.g. /new). */
  detachExternalId(sessionId: string): Promise<void>;
}
