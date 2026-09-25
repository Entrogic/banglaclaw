import type { Language, StopReason, ToolAuditEvent } from "@banglaclaw/shared";

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

/** Persistence boundary for runs and their tool calls. */
export interface RunStore {
  save(record: RunRecord): Promise<void>;
  get(id: string): Promise<RunRecord | undefined>;
  /** Most recent first. */
  listBySession(sessionId: string, options?: { limit?: number }): Promise<RunRecord[]>;
}
