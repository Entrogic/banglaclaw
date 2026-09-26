import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { mapChatMessagesToStoredMessages, mapStoredMessagesToChatMessages, type BaseMessage } from "@langchain/core/messages";
import { titleFromMessages, type NewSession, type Session, type SessionPatch, type SessionStatus, type SessionStore } from "@entrogic-net/session";
import type { Database } from "./db.js";
import { messages, sessions } from "./schema.js";

type SessionRow = typeof sessions.$inferSelect;

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    channel: row.channel,
    agentId: row.agentId,
    ...(row.title !== null && { title: row.title }),
    status: row.status as SessionStatus,
    ...(row.activeAgent !== null && { activeAgent: row.activeAgent }),
    ...(row.handoffReason !== null && { handoffReason: row.handoffReason }),
    ...(row.handoffAt !== null && { handoffAt: row.handoffAt }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.externalId !== null && { externalId: row.externalId }),
    ...(row.userId !== null && { userId: row.userId }),
  };
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly db: Database) {}

  async create(input: NewSession): Promise<Session> {
    const [row] = await this.db
      .insert(sessions)
      .values({
        channel: input.channel,
        agentId: input.agentId,
        externalId: input.externalId ?? null,
        userId: input.userId ?? null,
      })
      .returning();
    if (row === undefined) throw new Error("Session insert returned no row");
    return toSession(row);
  }

  async get(id: string): Promise<Session | undefined> {
    if (!isUuid(id)) return undefined;
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id));
    return row === undefined ? undefined : toSession(row);
  }

  async findByExternalId(channel: string, externalId: string): Promise<Session | undefined> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.channel, channel), eq(sessions.externalId, externalId)));
    return row === undefined ? undefined : toSession(row);
  }

  async update(id: string, patch: SessionPatch): Promise<Session | undefined> {
    if (!isUuid(id)) return undefined;
    const set: Partial<typeof sessions.$inferInsert> = { updatedAt: new Date() };
    if (patch.activeAgent !== undefined) set.activeAgent = patch.activeAgent;
    if (patch.handoffReason !== undefined) set.handoffReason = patch.handoffReason;
    if (patch.status !== undefined) {
      const current = await this.get(id);
      if (current !== undefined && current.status !== patch.status) {
        set.status = patch.status;
        if (patch.status === "handoff") set.handoffAt = new Date();
        else {
          set.handoffAt = null;
          set.handoffReason = null;
        }
      }
    }
    const [row] = await this.db.update(sessions).set(set).where(eq(sessions.id, id)).returning();
    return row === undefined ? undefined : toSession(row);
  }

  async list(options: { limit?: number; channel?: string; userId?: string; status?: SessionStatus; query?: string } = {}): Promise<Session[]> {
    const q = options.query?.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          options.channel !== undefined ? eq(sessions.channel, options.channel) : undefined,
          options.userId !== undefined ? eq(sessions.userId, options.userId) : undefined,
          options.status !== undefined ? eq(sessions.status, options.status) : undefined,
          q !== undefined && q !== "" ? or(ilike(sql`${sessions.id}::text`, `${q}%`), ilike(sessions.externalId, `%${q}%`), ilike(sessions.title, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(desc(sessions.updatedAt))
      .limit(options.limit ?? 50);
    return rows.map(toSession);
  }

  async appendMessages(sessionId: string, runId: string, batch: BaseMessage[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (batch.length > 0) {
        const stored = mapChatMessagesToStoredMessages(batch);
        await tx.insert(messages).values(stored.map((data) => ({ sessionId, runId, role: data.type, data })));
      }
      const title = titleFromMessages(batch);
      const updated = await tx
        .update(sessions)
        // The first title wins; later batches never overwrite it.
        .set({ updatedAt: new Date(), ...(title !== undefined && { title: sql`coalesce(${sessions.title}, ${title})` }) })
        .where(eq(sessions.id, sessionId))
        .returning({ id: sessions.id });
      if (updated.length === 0) throw new Error(`Unknown session ${sessionId}`);
    });
  }

  async recentMessages(sessionId: string, limit: number): Promise<BaseMessage[]> {
    if (limit <= 0) return [];
    const rows = await this.db
      .select({ data: messages.data })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.id))
      .limit(limit);
    return mapStoredMessagesToChatMessages(rows.reverse().map((r) => r.data));
  }

  async detachExternalId(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ externalId: null, updatedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async countMessages(sessionId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(messages).where(eq(messages.sessionId, sessionId));
    return row?.n ?? 0;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guards uuid columns so malformed ids read as "not found" instead of a Postgres cast error. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
