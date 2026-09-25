import { randomUUID } from "node:crypto";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { BanglaClawError, createLogger, type Logger, type RunEvent, type ToolAuditEvent } from "@banglaclaw/shared";
import type { ModelProvider } from "@banglaclaw/providers";
import type { PermissionPolicy, ToolRegistry } from "@banglaclaw/tools";
import { detectLanguage } from "./language.js";
import { buildAgentGraph, type RunLimits } from "./graph.js";
import { SYSTEM_PROMPT_VERSION } from "./prompts.js";
import { InMemoryRunStore, type RunRecord, type RunStatus, type RunStore } from "./run-store.js";
import type { AgentState } from "./state.js";

export interface AgentRuntimeOptions {
  provider: ModelProvider;
  registry: ToolRegistry;
  policy: PermissionPolicy;
  limits: RunLimits;
  timeoutMs: number;
  timezone: string;
  agentName?: string;
  store?: RunStore;
  logger?: Logger;
}

export interface RunOptions {
  sessionId: string;
  onEvent?: (event: RunEvent) => void;
  signal?: AbortSignal;
}

/** Thrown when a run fails; carries the persisted record. */
export class AgentRunError extends BanglaClawError {
  readonly record: RunRecord;

  constructor(record: RunRecord, options?: { cause?: unknown }) {
    super(record.status === "aborted" ? "RUN_ABORTED" : "RUN_FAILED", record.error ?? "Agent run failed", options);
    this.record = record;
  }
}

/**
 * Owns agent execution: builds the per-run context, invokes the LangGraph graph, streams
 * events, enforces the run timeout and persists a {@link RunRecord} for every run.
 */
export class AgentRuntime {
  readonly store: RunStore;
  readonly #options: AgentRuntimeOptions;
  readonly #logger: Logger;
  /** Short-term per-session history. Moves to the session package / PostgreSQL in v0.2. */
  readonly #history = new Map<string, BaseMessage[]>();

  constructor(options: AgentRuntimeOptions) {
    this.#options = options;
    this.store = options.store ?? new InMemoryRunStore();
    this.#logger = options.logger ?? createLogger({ level: "warn" });
  }

  history(sessionId: string): readonly BaseMessage[] {
    return this.#history.get(sessionId) ?? [];
  }

  resetSession(sessionId: string): void {
    this.#history.delete(sessionId);
  }

  async run(input: string, options: RunOptions): Promise<RunRecord> {
    const text = input.trim();
    if (text.length === 0) throw new BanglaClawError("EMPTY_INPUT", "Input message is empty");

    const { provider, registry, policy, limits, timeoutMs, timezone } = this.#options;
    const runId = randomUUID();
    const startedAt = new Date();
    const log = this.#logger.child({ runId, sessionId: options.sessionId, provider: provider.id });
    const emit = (event: RunEvent) => options.onEvent?.(event);
    const audits: ToolAuditEvent[] = [];

    const signals = [AbortSignal.timeout(timeoutMs)];
    if (options.signal !== undefined) signals.push(options.signal);
    const signal = AbortSignal.any(signals);

    const graph = buildAgentGraph({
      runId,
      agentName: this.#options.agentName ?? "BanglaClaw",
      timezone,
      provider,
      registry,
      policy,
      limits,
      signal,
      emit,
      onAudit: (event) => {
        audits.push(event);
        log.info("tool call", { tool: event.tool, status: event.status, durationMs: event.durationMs, error: event.error });
      },
    });

    const prior = this.history(options.sessionId);
    const human = new HumanMessage(text);
    let state: AgentState | undefined;
    let failure: unknown;

    const language = detectLanguage(text);
    log.info("run start", { language });
    emit({ type: "run_start", runId, sessionId: options.sessionId, language });
    try {
      state = await graph.invoke(
        { sessionId: options.sessionId, input: text, messages: [...prior, human] },
        { signal, recursionLimit: limits.maxIterations * 2 + 6 },
      );
    } catch (error) {
      failure = error;
    }

    const finishedAt = new Date();
    const aborted = failure !== undefined && signal.aborted;
    const status: RunStatus =
      failure === undefined ? (state?.stopReason === "completed" ? "completed" : "limited") : aborted ? "aborted" : "error";

    const record: RunRecord = {
      id: runId,
      sessionId: options.sessionId,
      provider: provider.id,
      promptVersion: SYSTEM_PROMPT_VERSION,
      input: text,
      status,
      iterations: state?.iterations ?? 0,
      toolCalls: audits,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      language,
      ...(state?.response !== undefined && { output: state.response }),
      ...(state?.stopReason !== undefined && { stopReason: state.stopReason }),
      ...(failure !== undefined && { error: describeFailure(failure, aborted, timeoutMs, options.signal) }),
    };

    await this.store.save(record);

    if (state === undefined) {
      log.error("run failed", { status, error: failure, durationMs: record.durationMs });
      emit({ type: "error", runId, message: record.error ?? "Agent run failed" });
      throw new AgentRunError(record, { cause: failure });
    }

    // Only commit history for runs that finished cleanly, so no dangling tool calls are stored.
    this.#history.set(options.sessionId, state.messages);
    log.info("run end", { status, iterations: record.iterations, toolCalls: audits.length, durationMs: record.durationMs });
    return record;
  }
}

function describeFailure(error: unknown, aborted: boolean, timeoutMs: number, callerSignal?: AbortSignal): string {
  if (aborted) {
    return callerSignal?.aborted === true ? "Run cancelled" : `Run timed out after ${timeoutMs}ms`;
  }
  return error instanceof Error ? error.message : String(error);
}
