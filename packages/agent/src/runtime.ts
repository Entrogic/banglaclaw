import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { BanglaClawError, createLogger, type Logger, type RunEvent, type ToolAuditEvent } from "@banglaclaw/shared";
import type { ModelProvider } from "@banglaclaw/providers";
import { trimHistory, type RunRecord, type RunStatus, type RunStore, type SessionStore } from "@banglaclaw/session";
import type { SkillSet } from "@banglaclaw/skills";
import type { PermissionPolicy, ToolRegistry } from "@banglaclaw/tools";
import { detectLanguage } from "./language.js";
import { buildAgentGraph, type RunLimits } from "./graph.js";
import { SYSTEM_PROMPT_VERSION } from "./prompts.js";
import type { AgentState } from "./state.js";

export interface AgentRuntimeOptions {
  provider: ModelProvider;
  registry: ToolRegistry;
  policy: PermissionPolicy;
  sessions: SessionStore;
  runs: RunStore;
  limits: RunLimits;
  timeoutMs: number;
  timezone: string;
  agentName?: string;
  /** Short-term memory window (messages). Default 20. */
  maxHistoryMessages?: number;
  skills?: SkillSet;
  /** Maximum skills activated per message. Default 2. */
  maxActiveSkills?: number;
  checkpointer?: BaseCheckpointSaver;
  logger?: Logger;
}

export interface RunOptions {
  /** Must refer to an existing session (see SessionManager.resolve). */
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
 * Owns agent execution: loads the session's short-term memory window, selects skills, invokes
 * the LangGraph graph, streams events, enforces the run timeout, and persists a
 * {@link RunRecord} for every run plus the new messages for successful ones.
 */
export class AgentRuntime {
  readonly #options: AgentRuntimeOptions;
  readonly #logger: Logger;

  constructor(options: AgentRuntimeOptions) {
    this.#options = options;
    this.#logger = options.logger ?? createLogger({ level: "warn" });
  }

  get sessions(): SessionStore {
    return this.#options.sessions;
  }

  get runs(): RunStore {
    return this.#options.runs;
  }

  /** The checkpointed graph state of a run, if checkpointing is enabled. */
  async checkpoint(runId: string): Promise<Partial<AgentState> | undefined> {
    const tuple = await this.#options.checkpointer?.getTuple({ configurable: { thread_id: runId } });
    return tuple?.checkpoint.channel_values as Partial<AgentState> | undefined;
  }

  async run(input: string, options: RunOptions): Promise<RunRecord> {
    const text = input.trim();
    if (text.length === 0) throw new BanglaClawError("EMPTY_INPUT", "Input message is empty");

    const { provider, registry, policy, limits, timeoutMs, timezone, sessions, runs } = this.#options;
    const session = await sessions.get(options.sessionId);
    if (session === undefined) throw new BanglaClawError("SESSION_NOT_FOUND", `Session not found: ${options.sessionId}`);

    const runId = randomUUID();
    const startedAt = new Date();
    const log = this.#logger.child({ runId, sessionId: session.id, provider: provider.id });
    const emit = (event: RunEvent) => options.onEvent?.(event);
    const audits: ToolAuditEvent[] = [];

    const signals = [AbortSignal.timeout(timeoutMs)];
    if (options.signal !== undefined) signals.push(options.signal);
    const signal = AbortSignal.any(signals);

    const language = detectLanguage(text);
    const skills = (this.#options.skills?.select(text, this.#options.maxActiveSkills ?? 2) ?? []).map((m) => m.skill);
    const skillNames = skills.map((s) => s.name);

    const graph = buildAgentGraph({
      runId,
      agentName: this.#options.agentName ?? "BanglaClaw",
      timezone,
      provider,
      registry,
      policy,
      limits,
      skills,
      ...(this.#options.checkpointer !== undefined && { checkpointer: this.#options.checkpointer }),
      signal,
      emit,
      onAudit: (event) => {
        audits.push(event);
        log.info("tool call", { tool: event.tool, status: event.status, durationMs: event.durationMs, error: event.error });
      },
    });

    const maxHistory = this.#options.maxHistoryMessages ?? 20;
    // Over-fetch slightly so trimming to a user-turn boundary still fills the window.
    const prior = trimHistory(await sessions.recentMessages(session.id, maxHistory + 10), maxHistory);
    let state: AgentState | undefined;
    let failure: unknown;

    log.info("run start", { language, skills: skillNames, historyMessages: prior.length });
    emit({ type: "run_start", runId, sessionId: session.id, language, skills: skillNames });
    try {
      state = await graph.invoke(
        { sessionId: session.id, input: text, messages: [...prior, new HumanMessage(text)] },
        { signal, recursionLimit: limits.maxIterations * 2 + 6, configurable: { thread_id: runId } },
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
      sessionId: session.id,
      provider: provider.id,
      promptVersion: SYSTEM_PROMPT_VERSION,
      language,
      skills: skillNames,
      input: text,
      status,
      iterations: state?.iterations ?? 0,
      toolCalls: audits,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ...(state?.response !== undefined && { output: state.response }),
      ...(state?.stopReason !== undefined && { stopReason: state.stopReason }),
      ...(failure !== undefined && { error: describeFailure(failure, aborted, timeoutMs, options.signal) }),
    };

    await runs.save(record);

    if (state === undefined) {
      log.error("run failed", { status, error: failure, durationMs: record.durationMs });
      emit({ type: "error", runId, message: record.error ?? "Agent run failed" });
      throw new AgentRunError(record, { cause: failure });
    }

    // Only persist messages for runs that finished, so no dangling tool calls are stored.
    await sessions.appendMessages(session.id, runId, state.messages.slice(prior.length));
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
