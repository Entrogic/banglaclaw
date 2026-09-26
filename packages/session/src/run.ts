import type { Language, StopReason, ToolAuditEvent } from "@entrogic-net/shared";

/** "handoff": the session is (or just became) owned by a human operator. */
export type RunStatus = "completed" | "limited" | "error" | "aborted" | "handoff";

export interface RunRecord {
  id: string;
  sessionId: string;
  provider: string;
  promptVersion: string;
  language: Language;
  skills: string[];
  /** Agent that produced the final answer (multi-agent), or "human" while handed off. */
  agent: string;
  /** Agents visited in order, including transfers. */
  agentPath: string[];
  handoffReason?: string;
  /** Model token usage summed over the run (when the provider reports it). */
  usage?: { inputTokens: number; outputTokens: number };
  input: string;
  output?: string;
  status: RunStatus;
  stopReason?: StopReason;
  error?: string;
  iterations: number;
  toolCalls: ToolAuditEvent[];
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

export interface StatsQuery {
  since: Date;
  until?: Date;
  /** IANA timezone for daily buckets (default UTC). */
  timezone?: string;
}

export interface DailyStats {
  /** YYYY-MM-DD in the query timezone. */
  date: string;
  runs: number;
  errors: number;
  handoffs: number;
  inputTokens: number;
  outputTokens: number;
}

/** Aggregates over agent runs (operator replies and messages stored during handoff are excluded). */
export interface RunStats {
  since: string;
  until: string;
  totals: {
    runs: number;
    completed: number;
    errors: number;
    limited: number;
    aborted: number;
    handoffs: number;
    inputTokens: number;
    outputTokens: number;
    avgDurationMs: number;
    sessions: number;
  };
  /** One entry per day in the range, zero-filled. */
  daily: DailyStats[];
  byChannel: { channel: string; runs: number }[];
  byProvider: { provider: string; runs: number; inputTokens: number; outputTokens: number }[];
  byAgent: { agent: string; runs: number }[];
  /** Up to 10 tools by call count (agent control tools excluded). */
  topTools: { tool: string; calls: number; failures: number }[];
}

/** Persistence boundary for runs and their tool calls. */
export interface RunStore {
  save(record: RunRecord): Promise<void>;
  get(id: string): Promise<RunRecord | undefined>;
  /** Most recent first. */
  listBySession(sessionId: string, options?: { limit?: number }): Promise<RunRecord[]>;
  stats(query: StatsQuery): Promise<RunStats>;
}
