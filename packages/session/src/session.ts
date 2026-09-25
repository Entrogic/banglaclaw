import type { BaseMessage } from "@langchain/core/messages";

/** A conversation on one channel (docs/06). */
export interface Session {
  id: string;
  channel: string;
  /** Channel-native conversation id (Telegram chat id, web session cookie, …). */
  externalId?: string;
  userId?: string;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
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
  list(options?: { limit?: number; channel?: string }): Promise<Session[]>;
  /** Appends messages produced by a run, in order, and bumps updatedAt. */
  appendMessages(sessionId: string, runId: string, messages: BaseMessage[]): Promise<void>;
  /** The most recent `limit` messages, oldest first. */
  recentMessages(sessionId: string, limit: number): Promise<BaseMessage[]>;
  countMessages(sessionId: string): Promise<number>;
}
