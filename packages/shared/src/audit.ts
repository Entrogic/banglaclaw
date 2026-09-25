import type { Logger } from "./logger.js";

export type AuditAction =
  | "auth.failed"
  | "auth.forbidden"
  | "rate_limited"
  | "key.created"
  | "key.revoked"
  | "tool.denied"
  | "handoff.requested"
  | "handoff.replied"
  | "handoff.released"
  | "memory.forgotten";

export type AuditOutcome = "success" | "failure" | "denied";

/** Security-relevant event (docs/14). Never put secrets or message content in metadata. */
export interface AuditEvent {
  id?: string;
  at: Date;
  action: AuditAction;
  outcome: AuditOutcome;
  /** User id, or "cli" / "system". */
  actorId?: string;
  actorName?: string;
  /** What was acted on: key id, session id, tool name, route… */
  target?: string;
  ip?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export type NewAuditEvent = Omit<AuditEvent, "at" | "id"> & { at?: Date };

export interface AuditStore {
  record(event: NewAuditEvent): Promise<void>;
  /** Most recent first. */
  list(options?: { action?: AuditAction; actorId?: string; limit?: number; since?: Date }): Promise<AuditEvent[]>;
}

export class InMemoryAuditStore implements AuditStore {
  readonly #events: AuditEvent[] = [];
  #seq = 0;

  async record(event: NewAuditEvent): Promise<void> {
    this.#events.push({ ...event, id: String(++this.#seq), at: event.at ?? new Date() });
    if (this.#events.length > 10_000) this.#events.shift();
  }

  async list(options: { action?: AuditAction; actorId?: string; limit?: number; since?: Date } = {}): Promise<AuditEvent[]> {
    return this.#events
      .filter((e) => (options.action === undefined || e.action === options.action) && (options.actorId === undefined || e.actorId === options.actorId))
      .filter((e) => options.since === undefined || e.at >= options.since)
      .slice()
      .reverse()
      .slice(0, options.limit ?? 100);
  }
}

/** Records audit events without ever failing the caller; also mirrors them to the log. */
export function auditRecorder(store: AuditStore | undefined, logger?: Logger): (event: NewAuditEvent) => void {
  return (event) => {
    logger?.info("audit", { action: event.action, outcome: event.outcome, actorId: event.actorId, target: event.target, requestId: event.requestId });
    if (store === undefined) return;
    void store.record(event).catch((error: unknown) => logger?.error("audit write failed", { action: event.action, error }));
  };
}
