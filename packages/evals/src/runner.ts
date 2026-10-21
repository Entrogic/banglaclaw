import { randomUUID } from "node:crypto";
import { AgentRunError, type AgentRuntime } from "@entrogic-net/agent";
import type { ModelProvider } from "@entrogic-net/providers";
import type { RunRecord, SessionStore } from "@entrogic-net/session";
import {
  BanglaClawError,
  DEFAULT_BUILTIN_METRICS,
  caseSucceeded,
  createLogger,
  type BuiltinEvalMetric,
  type EvalCase,
  type EvalDatasetStore,
  type EvalJob,
  type EvalMetricResult,
  type EvalRunner,
  type EvalStore,
  type Golden,
  type Logger,
  type StartEvalJob,
} from "@entrogic-net/shared";
import { DEFAULT_THRESHOLDS, JUDGE_METRICS, applies, judgeMetric, languageMatch, toolCorrectness, type EvalTranscript, type JudgeLanguage } from "./metrics.js";

/** Session channel for conversations an eval creates. */
export const EVAL_CHANNEL = "eval";
const MAX_JOBS_KEPT = 20;
const isControl = (tool: string) => tool.startsWith("transfer_to_") || tool === "request_human";

export class EvalJobError extends BanglaClawError {}

export interface EvalJobRunnerOptions {
  runtime: Pick<AgentRuntime, "run">;
  sessions: SessionStore;
  evals: EvalStore;
  datasets: EvalDatasetStore;
  agentName: string;
  /** The provider id the agent uses now, recorded with the run. */
  agentModel: () => string;
  /** The judge: a provider profile by id, or the agent's current provider when absent. Undefined = unknown profile. */
  judge: (profileId?: string) => Promise<ModelProvider | undefined>;
  /** Goldens in flight at once. Default 2. */
  parallel?: number;
  version?: string;
  logger?: Logger;
}

/**
 * Runs stored datasets through the agent inside the gateway process and records the scores like
 * any other eval run (docs/26, ADR-0020). One job at a time, so a click cannot multiply model cost.
 * Jobs live in memory; a restart ends a running job without recording it.
 */
export class EvalJobRunner implements EvalRunner {
  readonly #options: EvalJobRunnerOptions;
  readonly #logger: Logger;
  readonly #jobs = new Map<string, { job: EvalJob; controller: AbortController; done: Promise<void> }>();

  constructor(options: EvalJobRunnerOptions) {
    this.#options = options;
    this.#logger = options.logger ?? createLogger({ level: "warn" });
  }

  async start(input: StartEvalJob): Promise<EvalJob> {
    if (this.list().some((j) => j.status === "queued" || j.status === "running")) throw new EvalJobError("EVAL_JOB_RUNNING", "An eval is already running; wait for it or cancel it");
    const dataset = await this.#options.datasets.get(input.datasetId);
    if (dataset === undefined) throw new EvalJobError("DATASET_NOT_FOUND", "Dataset not found");
    const judgeNeeded = (input.metrics ?? DEFAULT_BUILTIN_METRICS).some((m) => JUDGE_METRICS.has(m));
    const judge = judgeNeeded ? await this.#options.judge(input.judgeProviderId) : undefined;
    if (judgeNeeded && judge === undefined) throw new EvalJobError("PROVIDER_NOT_FOUND", "Judge provider not found");

    const metrics = [...new Set(input.metrics ?? DEFAULT_BUILTIN_METRICS)];
    const job: EvalJob = {
      id: randomUUID(),
      status: "running",
      name: input.name ?? dataset.name,
      datasetId: dataset.id,
      datasetName: dataset.name,
      metrics,
      ...(judge !== undefined && { judgeModel: judge.id }),
      judgeLanguage: input.judgeLanguage ?? "bn",
      total: dataset.goldens.length,
      done: 0,
      passed: 0,
      ...(input.startedBy !== undefined && { startedBy: input.startedBy }),
      startedAt: new Date().toISOString(),
    };
    const controller = new AbortController();
    const done = this.#run(job, dataset.goldens, { judge, thresholds: input.thresholds ?? {}, signal: controller.signal });
    this.#jobs.set(job.id, { job, controller, done });
    this.#prune();
    return { ...job };
  }

  list(): EvalJob[] {
    return [...this.#jobs.values()].map((j) => ({ ...j.job })).reverse();
  }

  get(id: string): EvalJob | undefined {
    const entry = this.#jobs.get(id);
    return entry === undefined ? undefined : { ...entry.job };
  }

  cancel(id: string): boolean {
    const entry = this.#jobs.get(id);
    if (entry === undefined || entry.job.status !== "running") return false;
    entry.controller.abort(new Error("Eval cancelled"));
    return true;
  }

  /** Resolves when the job has finished (tests, shutdown). */
  async wait(id: string): Promise<EvalJob | undefined> {
    await this.#jobs.get(id)?.done;
    return this.get(id);
  }

  async #run(job: EvalJob, goldens: Golden[], ctx: { judge: ModelProvider | undefined; thresholds: Partial<Record<BuiltinEvalMetric, number>>; signal: AbortSignal }): Promise<void> {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
    const cases: (Omit<EvalCase, "success"> & { success: boolean })[] = new Array(goldens.length);
    let next = 0;
    const worker = async () => {
      while (next < goldens.length && !ctx.signal.aborted) {
        const index = next++;
        const golden = goldens[index];
        if (golden === undefined) continue;
        const c = await this.#case(job, golden, `eval/${job.name}/${stamp}/${golden.name}`.slice(0, 200), ctx);
        cases[index] = c;
        job.done += 1;
        if (c.success) job.passed += 1;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.max(1, Math.min(this.#options.parallel ?? 2, goldens.length)) }, worker));
      if (ctx.signal.aborted) {
        job.status = "cancelled";
        return;
      }
      const run = await this.#options.evals.save({
        name: job.name,
        dataset: job.datasetName,
        framework: "banglaclaw",
        ...(this.#options.version !== undefined && { frameworkVersion: this.#options.version }),
        ...(job.judgeModel !== undefined && { judgeModel: job.judgeModel }),
        agentModel: this.#options.agentModel(),
        metadata: { source: "dashboard", judgeLanguage: job.judgeLanguage, metrics: job.metrics.join(",") },
        ...(job.startedBy !== undefined && { createdBy: job.startedBy }),
        cases: cases.map(({ success: _s, ...c }) => c),
      });
      job.evalId = run.id;
      job.passed = run.passedCount;
      job.status = "completed";
    } catch (error) {
      if (ctx.signal.aborted) {
        job.status = "cancelled";
        return;
      }
      this.#logger.error("eval job failed", { jobId: job.id, error });
      job.status = "failed";
      job.error = error instanceof Error ? error.message.slice(0, 300) : "Eval failed";
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  }

  /** Sends the golden's earlier turns and its input in one session, then scores the result. */
  async #case(job: EvalJob, golden: Golden, externalId: string, ctx: { judge: ModelProvider | undefined; thresholds: Partial<Record<BuiltinEvalMetric, number>>; signal: AbortSignal }) {
    const base = {
      name: golden.name,
      input: golden.input,
      ...(golden.expected_output !== undefined && { expectedOutput: golden.expected_output }),
      ...(golden.expected_tools !== undefined && { expectedTools: golden.expected_tools }),
    };
    const session = await this.#options.sessions.create({ channel: EVAL_CHANNEL, agentId: this.#options.agentName, ...(job.startedBy !== undefined && { userId: job.startedBy }), externalId });
    const turns: EvalTranscript["turns"] = [];
    let record: RunRecord | undefined;
    for (const text of [...(golden.turns ?? []), golden.input]) {
      try {
        record = await this.#options.runtime.run(text, { sessionId: session.id, signal: ctx.signal });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        const message = error instanceof AgentRunError ? (error.record.error ?? error.record.status) : error instanceof Error ? error.message : String(error);
        const runId = error instanceof AgentRunError ? error.record.id : undefined;
        const failure: EvalMetricResult = { name: "Agent Run", threshold: 1, success: false, error: message.slice(0, 300) };
        return { ...base, sessionId: session.id, ...(runId !== undefined && { runId }), metrics: [failure], success: false };
      }
      turns.push({ user: text, assistant: record.output ?? "" });
    }
    if (record === undefined) throw new Error("unreachable: a golden has an input");

    const transcript: EvalTranscript = { golden, turns, language: record.language, toolsCalled: record.toolCalls.map((t) => t.tool).filter((t) => !isControl(t)) };
    const threshold = (m: BuiltinEvalMetric) => ctx.thresholds[m] ?? DEFAULT_THRESHOLDS[m];
    const metrics: EvalMetricResult[] = [];
    for (const metric of job.metrics.filter((m) => applies(m, golden))) {
      if (metric === "language_match") metrics.push(languageMatch(transcript, threshold(metric)));
      else if (metric === "tool_correctness") metrics.push(toolCorrectness(transcript, threshold(metric)));
      else if (ctx.judge !== undefined) metrics.push(await judgeMetric(metric, transcript, { judge: ctx.judge, language: job.judgeLanguage as JudgeLanguage, threshold: threshold(metric), signal: ctx.signal }));
    }
    return {
      ...base,
      actualOutput: record.output ?? "",
      language: record.language,
      sessionId: session.id,
      runId: record.id,
      toolsCalled: transcript.toolsCalled,
      metrics,
      success: caseSucceeded(metrics),
    };
  }

  #prune(): void {
    for (const [id, entry] of this.#jobs) {
      if (this.#jobs.size <= MAX_JOBS_KEPT) break;
      if (entry.job.status !== "running") this.#jobs.delete(id);
    }
  }
}
