import type { Language, StopReason, ToolAuditEvent } from "@banglaclaw/shared";

export type RunStatus = "completed" | "limited" | "error" | "aborted";

export interface RunRecord {
  id: string;
  sessionId: string;
  provider: string;
  promptVersion: string;
  language: Language;
  skills: string[];
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
