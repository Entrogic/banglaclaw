import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Language, StopReason, ToolAuditEvent } from "@banglaclaw/shared";
import type { RunRecord, RunStatus, RunStore } from "@banglaclaw/session";
import type { Database } from "./db.js";
import { runs, toolCalls } from "./schema.js";
import { isUuid } from "./sessions.js";

type RunRow = typeof runs.$inferSelect;
type ToolCallRow = typeof toolCalls.$inferSelect;

function toAudit(row: ToolCallRow): ToolAuditEvent {
  return {
    runId: row.runId,
    toolCallId: row.toolCallId,
    tool: row.tool,
    input: row.input,
    status: row.status as ToolAuditEvent["status"],
    durationMs: row.durationMs,
    ...(row.output !== null && { output: row.output }),
    ...(row.error !== null && { error: row.error }),
  };
}

function toRecord(row: RunRow, calls: ToolCallRow[]): RunRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    provider: row.provider,
    promptVersion: row.promptVersion,
    language: row.language as Language,
    skills: row.skills,
    input: row.input,
    status: row.status as RunStatus,
    iterations: row.iterations,
    toolCalls: calls.map(toAudit),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    ...(row.output !== null && { output: row.output }),
    ...(row.stopReason !== null && { stopReason: row.stopReason as StopReason }),
    ...(row.error !== null && { error: row.error }),
  };
}

export class PostgresRunStore implements RunStore {
  constructor(private readonly db: Database) {}

  /** Inserts the run and its tool calls atomically. */
  async save(record: RunRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(runs).values({
        id: record.id,
        sessionId: record.sessionId,
        provider: record.provider,
        promptVersion: record.promptVersion,
        language: record.language,
        skills: record.skills,
        input: record.input,
        output: record.output ?? null,
        status: record.status,
        stopReason: record.stopReason ?? null,
        error: record.error ?? null,
        iterations: record.iterations,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        durationMs: record.durationMs,
      });
      if (record.toolCalls.length > 0) {
        await tx.insert(toolCalls).values(
          record.toolCalls.map((call, seq) => ({
            runId: record.id,
            seq,
            toolCallId: call.toolCallId,
            tool: call.tool,
            input: call.input ?? null,
            status: call.status,
            output: call.output ?? null,
            error: call.error ?? null,
            durationMs: call.durationMs,
          })),
        );
      }
    });
  }

  async get(id: string): Promise<RunRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const [row] = await this.db.select().from(runs).where(eq(runs.id, id));
    if (row === undefined) return undefined;
    const calls = await this.db.select().from(toolCalls).where(eq(toolCalls.runId, id)).orderBy(asc(toolCalls.seq));
    return toRecord(row, calls);
  }

  async listBySession(sessionId: string, options: { limit?: number } = {}): Promise<RunRecord[]> {
    if (!isUuid(sessionId)) return [];
    const rows = await this.db
      .select()
      .from(runs)
      .where(eq(runs.sessionId, sessionId))
      .orderBy(desc(runs.startedAt))
      .limit(options.limit ?? 50);
    if (rows.length === 0) return [];
    const calls = await this.db
      .select()
      .from(toolCalls)
      .where(inArray(toolCalls.runId, rows.map((r) => r.id)))
      .orderBy(asc(toolCalls.seq));
    return rows.map((row) => toRecord(row, calls.filter((c) => c.runId === row.id)));
  }
}
