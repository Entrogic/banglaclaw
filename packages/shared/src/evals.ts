import { randomUUID } from "node:crypto";

/** One metric's verdict on a test case, as an evaluation framework (DeepEval) reports it (docs/26). */
export interface EvalMetricResult {
  name: string;
  /** 0–1; absent when the metric errored. */
  score?: number;
  threshold: number;
  success: boolean;
  reason?: string;
  error?: string;
}

/** One evaluated input: what the agent answered and how each metric scored it. */
export interface EvalCase {
  name?: string;
  input: string;
  actualOutput?: string;
  expectedOutput?: string;
  /** Language the agent detected (bn | bn-en | en). */
  language?: string;
  /** The BanglaClaw session and run that produced `actualOutput`. */
  sessionId?: string;
  runId?: string;
  toolsCalled?: string[];
  expectedTools?: string[];
  /** Passed when every metric passed. */
  success: boolean;
  metrics: EvalMetricResult[];
}

export interface EvalMetricSummary {
  name: string;
  /** Mean of the scores that were computed. */
  avgScore?: number;
  passed: number;
  total: number;
}

/** An evaluation run without its cases. */
export interface EvalRun {
  id: string;
  name: string;
  dataset?: string;
  /** e.g. "deepeval". */
  framework: string;
  frameworkVersion?: string;
  /** Judge model used by LLM-as-a-judge metrics. */
  judgeModel?: string;
  /** The agent's model/provider id when the run was recorded. */
  agentModel?: string;
  /** Free-form labels such as a git commit or CI job. */
  metadata?: Record<string, string | number | boolean>;
  /** User id of the admin who submitted it. */
  createdBy?: string;
  createdAt: Date;
  caseCount: number;
  passedCount: number;
  metrics: EvalMetricSummary[];
}

export type NewEvalRun = Omit<EvalRun, "id" | "createdAt" | "caseCount" | "passedCount" | "metrics"> & { cases: Omit<EvalCase, "success">[] };

export interface EvalStore {
  save(run: NewEvalRun): Promise<EvalRun>;
  /** Most recent first. */
  list(options?: { name?: string; limit?: number }): Promise<EvalRun[]>;
  get(id: string): Promise<{ run: EvalRun; cases: EvalCase[] } | undefined>;
  delete(id: string): Promise<boolean>;
}

/** A case passes when it has at least one metric and every metric passed. */
export function caseSucceeded(metrics: EvalMetricResult[]): boolean {
  return metrics.length > 0 && metrics.every((m) => m.success);
}

/** Counts and per-metric averages, in first-seen metric order. */
export function summarizeEval(cases: Pick<EvalCase, "metrics">[]): Pick<EvalRun, "caseCount" | "passedCount" | "metrics"> {
  const byName = new Map<string, { scores: number[]; passed: number; total: number }>();
  for (const c of cases) {
    for (const m of c.metrics) {
      const entry = byName.get(m.name) ?? { scores: [], passed: 0, total: 0 };
      entry.total += 1;
      if (m.success) entry.passed += 1;
      if (m.score !== undefined) entry.scores.push(m.score);
      byName.set(m.name, entry);
    }
  }
  return {
    caseCount: cases.length,
    passedCount: cases.filter((c) => caseSucceeded(c.metrics)).length,
    metrics: [...byName].map(([name, e]) => ({
      name,
      ...(e.scores.length > 0 && { avgScore: Math.round((e.scores.reduce((a, s) => a + s, 0) / e.scores.length) * 10_000) / 10_000 }),
      passed: e.passed,
      total: e.total,
    })),
  };
}

export class InMemoryEvalStore implements EvalStore {
  readonly #runs = new Map<string, { run: EvalRun; cases: EvalCase[] }>();

  async save(input: NewEvalRun): Promise<EvalRun> {
    const { cases, ...rest } = input;
    const stored = cases.map((c) => ({ ...c, success: caseSucceeded(c.metrics) }));
    const run: EvalRun = { ...rest, id: randomUUID(), createdAt: new Date(), ...summarizeEval(stored) };
    this.#runs.set(run.id, { run, cases: stored });
    if (this.#runs.size > 500) this.#runs.delete(this.#runs.keys().next().value ?? "");
    return run;
  }

  async list(options: { name?: string; limit?: number } = {}): Promise<EvalRun[]> {
    return [...this.#runs.values()]
      .map((e) => e.run)
      .filter((r) => options.name === undefined || r.name === options.name)
      .reverse()
      .slice(0, options.limit ?? 50);
  }

  async get(id: string): Promise<{ run: EvalRun; cases: EvalCase[] } | undefined> {
    return this.#runs.get(id);
  }

  async delete(id: string): Promise<boolean> {
    return this.#runs.delete(id);
  }
}
