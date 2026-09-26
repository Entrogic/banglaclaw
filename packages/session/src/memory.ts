import { randomUUID } from "node:crypto";
import type { BaseMessage } from "@langchain/core/messages";
import type { RunRecord, RunStats, RunStore, StatsQuery } from "./run.js";
import { computeStats } from "./stats.js";
import type { NewSession, Session, SessionPatch, SessionStatus, SessionStore } from "./session.js";
import { titleFromMessages } from "./title.js";

/** Process-local session store (storage.provider: memory). */
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #messages = new Map<string, BaseMessage[]>();

  async create(input: NewSession): Promise<Session> {
    if (input.externalId !== undefined && (await this.findByExternalId(input.channel, input.externalId)) !== undefined) {
      throw new Error(`Session already exists for ${input.channel}:${input.externalId}`);
    }
    const now = new Date();
    const session: Session = { id: randomUUID(), ...input, status: "active", createdAt: now, updatedAt: now };
    this.#sessions.set(session.id, session);
    this.#messages.set(session.id, []);
    return { ...session };
  }

  async get(id: string): Promise<Session | undefined> {
    const s = this.#sessions.get(id);
    return s === undefined ? undefined : { ...s };
  }

  async findByExternalId(channel: string, externalId: string): Promise<Session | undefined> {
    for (const s of this.#sessions.values()) {
      if (s.channel === channel && s.externalId === externalId) return { ...s };
    }
    return undefined;
  }

  async list(options: { limit?: number; channel?: string; userId?: string; status?: SessionStatus; query?: string } = {}): Promise<Session[]> {
    const q = options.query?.trim().toLowerCase();
    return [...this.#sessions.values()]
      .filter((s) => q === undefined || q === "" || s.id.startsWith(q) || (s.externalId?.toLowerCase().includes(q) ?? false) || (s.title?.toLowerCase().includes(q) ?? false))
      .filter((s) => options.channel === undefined || s.channel === options.channel)
      .filter((s) => options.status === undefined || s.status === options.status)
      .filter((s) => options.userId === undefined || s.userId === options.userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, options.limit ?? 50)
      .map((s) => ({ ...s }));
  }

  async update(id: string, patch: SessionPatch): Promise<Session | undefined> {
    const s = this.#sessions.get(id);
    if (s === undefined) return undefined;
    applyPatch(s, patch);
    return { ...s };
  }

  async appendMessages(sessionId: string, _runId: string, messages: BaseMessage[]): Promise<void> {
    const session = this.#sessions.get(sessionId);
    const history = this.#messages.get(sessionId);
    if (session === undefined || history === undefined) throw new Error(`Unknown session ${sessionId}`);
    history.push(...messages);
    session.updatedAt = new Date();
    if (session.title === undefined) {
      const title = titleFromMessages(messages);
      if (title !== undefined) session.title = title;
    }
  }

  async recentMessages(sessionId: string, limit: number): Promise<BaseMessage[]> {
    if (limit <= 0) return [];
    return (this.#messages.get(sessionId) ?? []).slice(-limit);
  }

  async countMessages(sessionId: string): Promise<number> {
    return this.#messages.get(sessionId)?.length ?? 0;
  }

  async detachExternalId(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session !== undefined) {
      delete session.externalId;
      session.updatedAt = new Date();
    }
  }
}

function applyPatch(s: Session, patch: SessionPatch): void {
  if (patch.activeAgent !== undefined) {
    if (patch.activeAgent === null) delete s.activeAgent;
    else s.activeAgent = patch.activeAgent;
  }
  if (patch.status !== undefined && patch.status !== s.status) {
    s.status = patch.status;
    if (patch.status === "handoff") s.handoffAt = new Date();
    else {
      delete s.handoffAt;
      delete s.handoffReason;
    }
  }
  if (patch.handoffReason !== undefined) {
    if (patch.handoffReason === null) delete s.handoffReason;
    else s.handoffReason = patch.handoffReason;
  }
  s.updatedAt = new Date();
}

export class InMemoryRunStore implements RunStore {
  readonly #runs = new Map<string, RunRecord>();

  /** `sessions` lets stats break runs down by channel. */
  constructor(private readonly sessions?: InMemorySessionStore) {}

  async stats(query: StatsQuery): Promise<RunStats> {
    const channels = new Map<string, string>();
    for (const s of (await this.sessions?.list({ limit: Number.MAX_SAFE_INTEGER })) ?? []) channels.set(s.id, s.channel);
    return computeStats([...this.#runs.values()], query, (id) => channels.get(id) ?? "unknown");
  }

  async save(record: RunRecord): Promise<void> {
    this.#runs.set(record.id, structuredClone(record));
  }

  async get(id: string): Promise<RunRecord | undefined> {
    const record = this.#runs.get(id);
    return record === undefined ? undefined : structuredClone(record);
  }

  async listBySession(sessionId: string, options: { limit?: number } = {}): Promise<RunRecord[]> {
    return [...this.#runs.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, options.limit ?? 50)
      .map((r) => structuredClone(r));
  }
}
