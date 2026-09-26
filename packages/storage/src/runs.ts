import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Language, StopReason, ToolAuditEvent } from "@entrogic-net/shared";
import { dayRange, type RunRecord, type RunStats, type RunStatus, type RunStore, type StatsQuery } from "@entrogic-net/session";
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
    agent: row.agent,
    agentPath: row.agentPath,
    ...(row.handoffReason !== null && { handoffReason: row.handoffReason }),
    ...((row.inputTokens > 0 || row.outputTokens > 0) && { usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens } }),
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

const num = (v: unknown) => Number(v ?? 0);

export class PostgresRunStore implements RunStore {
  constructor(private readonly db: Database) {}

  /** Aggregated in SQL; daily buckets use `timezone` (default UTC). */
  async stats(query: StatsQuery): Promise<RunStats> {
    const since = query.since;
    const until = query.until ?? new Date();
    const tz = query.timezone ?? "UTC";
    const range = sql`r.agent <> 'human' and r.started_at >= ${since} and r.started_at <= ${until}`;
    const rows = async <T>(q: ReturnType<typeof sql>) => (await this.db.execute(q)).rows as T[];

    const [t] = await rows<Record<string, unknown>>(sql`
      select count(*) runs,
        count(*) filter (where status = 'completed') completed, count(*) filter (where status = 'error') errors,
        count(*) filter (where status = 'limited') limited, count(*) filter (where status = 'aborted') aborted,
        count(*) filter (where status = 'handoff') handoffs,
        coalesce(sum(input_tokens), 0) input_tokens, coalesce(sum(output_tokens), 0) output_tokens,
        coalesce(round(avg(duration_ms)), 0) avg_duration, count(distinct session_id) sessions
      from runs r where ${range}`);
    const daily = await rows<Record<string, unknown>>(sql`
      select to_char(r.started_at at time zone ${tz}, 'YYYY-MM-DD') date, count(*) runs,
        count(*) filter (where status = 'error') errors, count(*) filter (where status = 'handoff') handoffs,
        coalesce(sum(input_tokens), 0) input_tokens, coalesce(sum(output_tokens), 0) output_tokens
      from runs r where ${range} group by 1`);
    const byChannel = await rows<Record<string, unknown>>(sql`
      select coalesce(s.channel, 'unknown') channel, count(*) runs from runs r left join sessions s on s.id = r.session_id
      where ${range} group by 1 order by 2 desc`);
    const byProvider = await rows<Record<string, unknown>>(sql`
      select provider, count(*) runs, coalesce(sum(input_tokens), 0) input_tokens, coalesce(sum(output_tokens), 0) output_tokens
      from runs r where ${range} group by 1 order by 2 desc`);
    const byAgent = await rows<Record<string, unknown>>(sql`select agent, count(*) runs from runs r where ${range} group by 1 order by 2 desc`);
    const topTools = await rows<Record<string, unknown>>(sql`
      select tc.tool, count(*) calls, count(*) filter (where tc.status <> 'ok') failures
      from tool_calls tc join runs r on r.id = tc.run_id
      where ${range} and tc.tool not like 'transfer\_to\_%' and tc.tool <> 'request_human'
      group by 1 order by 2 desc limit 10`);

    const byDay = new Map(daily.map((d) => [String(d.date), d]));
    return {
      since: since.toISOString(),
      until: until.toISOString(),
      totals: {
        runs: num(t?.runs), completed: num(t?.completed), errors: num(t?.errors), limited: num(t?.limited), aborted: num(t?.aborted),
        handoffs: num(t?.handoffs), inputTokens: num(t?.input_tokens), outputTokens: num(t?.output_tokens),
        avgDurationMs: num(t?.avg_duration), sessions: num(t?.sessions),
      },
      daily: dayRange(since, until, tz).map((date) => {
        const d = byDay.get(date);
        return { date, runs: num(d?.runs), errors: num(d?.errors), handoffs: num(d?.handoffs), inputTokens: num(d?.input_tokens), outputTokens: num(d?.output_tokens) };
      }),
      byChannel: byChannel.map((r) => ({ channel: String(r.channel), runs: num(r.runs) })),
      byProvider: byProvider.map((r) => ({ provider: String(r.provider), runs: num(r.runs), inputTokens: num(r.input_tokens), outputTokens: num(r.output_tokens) })),
      byAgent: byAgent.map((r) => ({ agent: String(r.agent), runs: num(r.runs) })),
      topTools: topTools.map((r) => ({ tool: String(r.tool), calls: num(r.calls), failures: num(r.failures) })),
    };
  }

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
        agent: record.agent,
        agentPath: record.agentPath,
        handoffReason: record.handoffReason ?? null,
        inputTokens: record.usage?.inputTokens ?? 0,
        outputTokens: record.usage?.outputTokens ?? 0,
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

  /** Tool calls go with the runs (ON DELETE CASCADE); deleting the session already does this. */
  async deleteBySession(sessionId: string): Promise<void> {
    if (!isUuid(sessionId)) return;
    await this.db.delete(runs).where(eq(runs.sessionId, sessionId));
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
