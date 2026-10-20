import { asc, desc, eq } from "drizzle-orm";
import { caseSucceeded, summarizeEval, type EvalCase, type EvalRun, type EvalStore, type NewEvalRun } from "@entrogic-net/shared";
import type { Database } from "./db.js";
import { evalCases, evalRuns } from "./schema.js";
import { isUuid } from "./sessions.js";

type RunRow = typeof evalRuns.$inferSelect;
type CaseRow = typeof evalCases.$inferSelect;

function toRun(r: RunRow): EvalRun {
  return {
    id: r.id,
    name: r.name,
    ...(r.dataset !== null && { dataset: r.dataset }),
    framework: r.framework,
    ...(r.frameworkVersion !== null && { frameworkVersion: r.frameworkVersion }),
    ...(r.judgeModel !== null && { judgeModel: r.judgeModel }),
    ...(r.agentModel !== null && { agentModel: r.agentModel }),
    ...(r.metadata !== null && { metadata: r.metadata }),
    ...(r.createdBy !== null && { createdBy: r.createdBy }),
    createdAt: r.createdAt,
    caseCount: r.caseCount,
    passedCount: r.passedCount,
    metrics: r.metrics,
  };
}

function toCase(r: CaseRow): EvalCase {
  return {
    ...(r.name !== null && { name: r.name }),
    input: r.input,
    ...(r.actualOutput !== null && { actualOutput: r.actualOutput }),
    ...(r.expectedOutput !== null && { expectedOutput: r.expectedOutput }),
    ...(r.language !== null && { language: r.language }),
    ...(r.sessionId !== null && { sessionId: r.sessionId }),
    ...(r.runId !== null && { runId: r.runId }),
    ...(r.toolsCalled !== null && { toolsCalled: r.toolsCalled }),
    ...(r.expectedTools !== null && { expectedTools: r.expectedTools }),
    success: r.success,
    metrics: r.metrics,
  };
}

export class PostgresEvalStore implements EvalStore {
  constructor(private readonly db: Database) {}

  async save(input: NewEvalRun): Promise<EvalRun> {
    const { cases, ...run } = input;
    const summary = summarizeEval(cases);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(evalRuns)
        .values({
          name: run.name,
          dataset: run.dataset ?? null,
          framework: run.framework,
          frameworkVersion: run.frameworkVersion ?? null,
          judgeModel: run.judgeModel ?? null,
          agentModel: run.agentModel ?? null,
          metadata: run.metadata ?? null,
          createdBy: run.createdBy ?? null,
          ...summary,
        })
        .returning();
      if (row === undefined) throw new Error("eval run insert returned no row");
      if (cases.length > 0) {
        await tx.insert(evalCases).values(
          cases.map((c, seq) => ({
            evalId: row.id,
            seq,
            name: c.name ?? null,
            input: c.input,
            actualOutput: c.actualOutput ?? null,
            expectedOutput: c.expectedOutput ?? null,
            language: c.language ?? null,
            sessionId: c.sessionId ?? null,
            runId: c.runId ?? null,
            toolsCalled: c.toolsCalled ?? null,
            expectedTools: c.expectedTools ?? null,
            success: caseSucceeded(c.metrics),
            metrics: c.metrics,
          })),
        );
      }
      return toRun(row);
    });
  }

  async list(options: { name?: string; limit?: number } = {}): Promise<EvalRun[]> {
    const rows = await this.db
      .select()
      .from(evalRuns)
      .where(options.name !== undefined ? eq(evalRuns.name, options.name) : undefined)
      .orderBy(desc(evalRuns.createdAt))
      .limit(options.limit ?? 50);
    return rows.map(toRun);
  }

  async get(id: string): Promise<{ run: EvalRun; cases: EvalCase[] } | undefined> {
    if (!isUuid(id)) return undefined;
    const [row] = await this.db.select().from(evalRuns).where(eq(evalRuns.id, id));
    if (row === undefined) return undefined;
    const cases = await this.db.select().from(evalCases).where(eq(evalCases.evalId, id)).orderBy(asc(evalCases.seq));
    return { run: toRun(row), cases: cases.map(toCase) };
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const deleted = await this.db.delete(evalRuns).where(eq(evalRuns.id, id)).returning({ id: evalRuns.id });
    return deleted.length > 0;
  }
}

