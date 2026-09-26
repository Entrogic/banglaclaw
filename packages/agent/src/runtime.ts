import { randomUUID } from "node:crypto";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { BanglaClawError, createLogger, type Language, type Logger, type NewAuditEvent, type RunEvent, type ToolAuditEvent } from "@entrogic-net/shared";
import type { ModelProvider } from "@entrogic-net/providers";
import { trimHistory, type RunRecord, type RunStatus, type RunStore, type Session, type SessionStore } from "@entrogic-net/session";
import type { SkillSet } from "@entrogic-net/skills";
import type { PermissionPolicy, ToolRegistry } from "@entrogic-net/tools";
import { detectLanguage } from "./language.js";
import { SUPERVISOR, buildAgentGraph, type RunLimits, type TeamOptions } from "./graph.js";
import { SYSTEM_PROMPT_VERSION } from "./prompts.js";
import type { AgentState } from "./state.js";

export interface RunContext {
  session: Session;
  input: string;
  language: Language;
  signal: AbortSignal;
}

/**
 * Adds background context to a run's system prompt (e.g. recalled long-term memories).
 * Returning undefined adds nothing. Failures are logged and skipped, never fatal.
 */
export type ContextProvider = (ctx: RunContext) => Promise<string | undefined>;

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
  contextProviders?: ContextProvider[];
  /** Specialist agents and human handoff (multi-agent). Omit for a single agent. */
  team?: TeamOptions;
  /** Called after a run hands its session to a human operator (e.g. notify a webhook). Errors are logged. */
  onHandoff?: (session: Session, reason: string) => void | Promise<void>;
  /** Called with every saved run record (metrics). Must not throw. */
  onRunComplete?: (record: RunRecord, session: Session) => void;
  /** Security audit sink (tool denials, handoff requests). Must not throw. */
  audit?: (event: NewAuditEvent) => void;
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

  #complete(record: RunRecord, session: Session, log: Logger): void {
    try {
      this.#options.onRunComplete?.(record, session);
    } catch (error) {
      log.warn("onRunComplete hook failed", { error });
    }
  }

  async #collectContext(ctx: RunContext, log: Logger): Promise<string[]> {
    const providers = this.#options.contextProviders ?? [];
    const results = await Promise.allSettled(providers.map((p) => p(ctx)));
    const blocks: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value !== undefined && r.value.trim() !== "") blocks.push(r.value.trim());
      } else {
        log.warn("context provider failed", { error: r.reason });
      }
    }
    return blocks;
  }

  /** Runs the agent inside an `invoke_agent` trace span (no-op unless OpenTelemetry is configured). */
  async run(input: string, options: RunOptions): Promise<RunRecord> {
    return tracer.startActiveSpan("invoke_agent banglaclaw", async (span) => {
      try {
        const record = await this.#run(input, options);
        span.setAttributes(spanAttributes(record));
        return record;
      } catch (error) {
        if (error instanceof AgentRunError) span.setAttributes(spanAttributes(error.record));
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async #run(input: string, options: RunOptions): Promise<RunRecord> {
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

    if (session.status === "handoff") return this.#recordWhileHandedOff(session, text, runId, startedAt, emit, log);

    const signals = [AbortSignal.timeout(timeoutMs)];
    if (options.signal !== undefined) signals.push(options.signal);
    const signal = AbortSignal.any(signals);

    const language = detectLanguage(text);
    const skills = (this.#options.skills?.select(text, this.#options.maxActiveSkills ?? 2) ?? []).map((m) => m.skill);
    const skillNames = skills.map((s) => s.name);
    const context = await this.#collectContext({ session, input: text, language, signal }, log);

    const team = this.#options.team;
    const startAgent = session.activeAgent !== undefined && team?.profiles.some((p) => p.name === session.activeAgent) === true ? session.activeAgent : SUPERVISOR;

    const graph = buildAgentGraph({
      runId,
      agentName: this.#options.agentName ?? "BanglaClaw",
      timezone,
      provider,
      registry,
      policy,
      limits,
      skills,
      context,
      ...(team !== undefined && { team }),
      ...(this.#options.checkpointer !== undefined && { checkpointer: this.#options.checkpointer }),
      signal,
      emit,
      onAudit: (event) => {
        audits.push(event);
        if (event.status === "denied") {
          this.#options.audit?.({
            action: "tool.denied",
            outcome: "denied",
            ...(session.userId !== undefined && { actorId: session.userId }),
            target: event.tool,
            metadata: { runId, sessionId: session.id, channel: session.channel, reason: event.error },
          });
        }
        log.info("tool call", { tool: event.tool, status: event.status, durationMs: event.durationMs, error: event.error });
      },
    });

    const maxHistory = this.#options.maxHistoryMessages ?? 20;
    // Over-fetch slightly so trimming to a user-turn boundary still fills the window.
    const prior = trimHistory(await sessions.recentMessages(session.id, maxHistory + 10), maxHistory);
    let state: AgentState | undefined;
    let failure: unknown;

    log.info("run start", { language, skills: skillNames, agent: startAgent, historyMessages: prior.length });
    emit({ type: "run_start", runId, sessionId: session.id, language, skills: skillNames, agent: startAgent });
    try {
      state = await graph.invoke(
        { sessionId: session.id, input: text, activeAgent: startAgent, messages: [...prior, new HumanMessage(text)] },
        { signal, recursionLimit: limits.maxIterations * 2 + 6, configurable: { thread_id: runId } },
      );
    } catch (error) {
      failure = error;
    }

    const finishedAt = new Date();
    const aborted = failure !== undefined && signal.aborted;
    const status: RunStatus =
      failure !== undefined
        ? aborted
          ? "aborted"
          : "error"
        : state?.stopReason === "completed"
          ? "completed"
          : state?.stopReason === "handoff"
            ? "handoff"
            : "limited";

    const record: RunRecord = {
      id: runId,
      sessionId: session.id,
      provider: provider.id,
      promptVersion: SYSTEM_PROMPT_VERSION,
      language,
      skills: skillNames,
      agent: state?.activeAgent ?? startAgent,
      agentPath: state?.agentPath ?? [startAgent],
      ...(state?.handoffReason !== undefined && { handoffReason: state.handoffReason }),
      ...(state !== undefined && (state.inputTokens > 0 || state.outputTokens > 0) && { usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens } }),
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
    this.#complete(record, session, log);

    if (state === undefined) {
      log.error("run failed", { status, error: failure, durationMs: record.durationMs });
      emit({ type: "error", runId, message: record.error ?? "Agent run failed" });
      throw new AgentRunError(record, { cause: failure });
    }

    // Only persist messages for runs that finished, so no dangling tool calls are stored.
    await sessions.appendMessages(session.id, runId, state.messages.slice(prior.length));

    const nextAgent = state.activeAgent === SUPERVISOR ? null : state.activeAgent;
    if (state.handoffReason !== undefined) {
      const updated = await sessions.update(session.id, { status: "handoff", handoffReason: state.handoffReason, activeAgent: nextAgent });
      log.warn("session handed off to a human", { reason: state.handoffReason });
      this.#options.audit?.({
        action: "handoff.requested",
        outcome: "success",
        ...(session.userId !== undefined && { actorId: session.userId }),
        target: session.id,
        metadata: { runId, channel: session.channel, agent: state.activeAgent, reason: state.handoffReason },
      });
      try {
        await this.#options.onHandoff?.(updated ?? session, state.handoffReason);
      } catch (error) {
        log.error("handoff notification failed", { error });
      }
    } else if ((session.activeAgent ?? null) !== nextAgent) {
      await sessions.update(session.id, { activeAgent: nextAgent });
    }
    log.info("run end", { status, agent: record.agent, iterations: record.iterations, toolCalls: audits.length, durationMs: record.durationMs });
    return record;
  }

  /** While a human owns the session, user messages are stored for the operator and the bot stays silent. */
  async #recordWhileHandedOff(session: Session, text: string, runId: string, startedAt: Date, emit: (e: RunEvent) => void, log: Logger): Promise<RunRecord> {
    const language = detectLanguage(text);
    emit({ type: "run_start", runId, sessionId: session.id, language, skills: [], agent: "human" });
    emit({ type: "handoff", runId, reason: session.handoffReason ?? "", pending: true });
    const finishedAt = new Date();
    const record: RunRecord = {
      id: runId,
      sessionId: session.id,
      provider: "human",
      promptVersion: SYSTEM_PROMPT_VERSION,
      language,
      skills: [],
      agent: "human",
      agentPath: ["human"],
      ...(session.handoffReason !== undefined && { handoffReason: session.handoffReason }),
      input: text,
      status: "handoff",
      stopReason: "handoff",
      iterations: 0,
      toolCalls: [],
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
    // Save the run before its message: messages.run_id references runs in PostgreSQL.
    await this.#options.runs.save(record);
    this.#complete(record, session, log);
    await this.#options.sessions.appendMessages(session.id, runId, [new HumanMessage(text)]);
    log.info("message stored for human operator");
    return record;
  }
}

const tracer = trace.getTracer("banglaclaw.agent");

function spanAttributes(r: RunRecord): Record<string, string | number> {
  return {
    "gen_ai.operation.name": "invoke_agent",
    "banglaclaw.run_id": r.id,
    "banglaclaw.session_id": r.sessionId,
    "banglaclaw.run.status": r.status,
    "banglaclaw.agent": r.agent,
    "banglaclaw.agent_path": r.agentPath.join(">"),
    "banglaclaw.language": r.language,
    "banglaclaw.tool_calls": r.toolCalls.length,
    "gen_ai.usage.input_tokens": r.usage?.inputTokens ?? 0,
    "gen_ai.usage.output_tokens": r.usage?.outputTokens ?? 0,
  };
}

function describeFailure(error: unknown, aborted: boolean, timeoutMs: number, callerSignal?: AbortSignal): string {
  if (aborted) {
    return callerSignal?.aborted === true ? "Run cancelled" : `Run timed out after ${timeoutMs}ms`;
  }
  return error instanceof Error ? error.message : String(error);
}
