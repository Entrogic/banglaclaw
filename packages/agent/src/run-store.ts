import type { Language, ToolAuditEvent } from "@banglaclaw/shared";
import type { StopReason } from "./state.js";

export type RunStatus = "completed" | "limited" | "error" | "aborted";

export interface RunRecord {
  id: string;
  sessionId: string;
  provider: string;
  promptVersion: string;
  language: Language;
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

/** Persistence boundary for runs. v0.1 ships in-memory; PostgreSQL arrives in v0.2. */
export interface RunStore {
  save(record: RunRecord): Promise<void>;
  get(id: string): Promise<RunRecord | undefined>;
  listBySession(sessionId: string): Promise<RunRecord[]>;
}

export class InMemoryRunStore implements RunStore {
  readonly #runs = new Map<string, RunRecord>();

  async save(record: RunRecord): Promise<void> {
    this.#runs.set(record.id, structuredClone(record));
  }

  async get(id: string): Promise<RunRecord | undefined> {
    const record = this.#runs.get(id);
    return record === undefined ? undefined : structuredClone(record);
  }

  async listBySession(sessionId: string): Promise<RunRecord[]> {
    return [...this.#runs.values()].filter((r) => r.sessionId === sessionId).map((r) => structuredClone(r));
  }
}
