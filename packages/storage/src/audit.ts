import { and, desc, eq, gte } from "drizzle-orm";
import type { AuditAction, AuditEvent, AuditOutcome, AuditStore, NewAuditEvent } from "@banglaclaw/shared";
import type { Database } from "./db.js";
import { auditLogs } from "./schema.js";

export class PostgresAuditStore implements AuditStore {
  constructor(private readonly db: Database) {}

  async record(event: NewAuditEvent): Promise<void> {
    await this.db.insert(auditLogs).values({
      at: event.at ?? new Date(),
      action: event.action,
      outcome: event.outcome,
      actorId: event.actorId ?? null,
      actorName: event.actorName ?? null,
      target: event.target ?? null,
      ip: event.ip ?? null,
      requestId: event.requestId ?? null,
      metadata: event.metadata ?? null,
    });
  }

  async list(options: { action?: AuditAction; actorId?: string; limit?: number; since?: Date } = {}): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(
        and(
          options.action !== undefined ? eq(auditLogs.action, options.action) : undefined,
          options.actorId !== undefined ? eq(auditLogs.actorId, options.actorId) : undefined,
          options.since !== undefined ? gte(auditLogs.at, options.since) : undefined,
        ),
      )
      .orderBy(desc(auditLogs.id))
      .limit(options.limit ?? 100);
    return rows.map((r) => ({
      id: String(r.id),
      at: r.at,
      action: r.action as AuditAction,
      outcome: r.outcome as AuditOutcome,
      ...(r.actorId !== null && { actorId: r.actorId }),
      ...(r.actorName !== null && { actorName: r.actorName }),
      ...(r.target !== null && { target: r.target }),
      ...(r.ip !== null && { ip: r.ip }),
      ...(r.requestId !== null && { requestId: r.requestId }),
      ...(r.metadata !== null && { metadata: r.metadata }),
    }));
  }
}
