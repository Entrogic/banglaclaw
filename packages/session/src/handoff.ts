import { randomUUID } from "node:crypto";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { NewAuditEvent } from "@banglaclaw/shared";
import type { RunStore } from "./run.js";
import type { Session, SessionStore } from "./session.js";

export class HandoffError extends Error {
  constructor(
    readonly code: "session_not_found" | "not_handed_off",
    message: string,
  ) {
    super(message);
    this.name = "HandoffError";
  }
}

/** Pushes an operator's text to the user's platform (Telegram, WhatsApp…). Returns false if the channel can't deliver. */
export type Deliver = (session: Session, text: string) => Promise<boolean>;

export function isOperatorMessage(m: BaseMessage): boolean {
  return m.getType() === "ai" && typeof m.response_metadata === "object" && m.response_metadata !== null && "operator" in m.response_metadata;
}

/**
 * Human handoff queue (docs/04): lists sessions waiting for a person, lets an operator reply
 * through the session's channel, and releases the session back to the bot. Operator replies are
 * stored as assistant messages tagged with `response_metadata.operator` and audited as runs.
 */
export class HandoffDesk {
  constructor(
    private readonly sessions: SessionStore,
    private readonly runs: RunStore,
    private readonly deliver?: Deliver,
    private readonly audit?: (event: NewAuditEvent) => void,
  ) {}

  queue(limit = 50): Promise<Session[]> {
    return this.sessions.list({ status: "handoff", limit });
  }

  async get(sessionId: string, messageLimit = 50): Promise<{ session: Session; messages: BaseMessage[] }> {
    const session = await this.#session(sessionId);
    return { session, messages: await this.sessions.recentMessages(session.id, messageLimit) };
  }

  async reply(sessionId: string, operator: string, text: string): Promise<{ delivered: boolean; runId: string }> {
    const session = await this.#session(sessionId);
    if (session.status !== "handoff") throw new HandoffError("not_handed_off", "Session is not waiting for a human");
    const runId = randomUUID();
    const now = new Date();
    await this.runs.save({
      id: runId,
      sessionId: session.id,
      provider: `operator:${operator}`,
      promptVersion: "operator",
      language: /\p{Script=Bengali}/u.test(text) ? "bn" : "en",
      skills: [],
      agent: "human",
      agentPath: ["human"],
      input: "(operator reply)",
      output: text,
      status: "handoff",
      stopReason: "handoff",
      iterations: 0,
      toolCalls: [],
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
    });
    await this.sessions.appendMessages(session.id, runId, [new AIMessage({ content: text, response_metadata: { operator } })]);
    const delivered = this.deliver !== undefined ? await this.deliver(session, text) : false;
    this.audit?.({ action: "handoff.replied", outcome: "success", actorName: operator, target: session.id, metadata: { runId, channel: session.channel, delivered } });
    return { delivered, runId };
  }

  /** Returns the session to the bot (supervisor). */
  async release(sessionId: string, operator?: string): Promise<Session> {
    const session = await this.#session(sessionId);
    if (session.status !== "handoff") throw new HandoffError("not_handed_off", "Session is not waiting for a human");
    const released = (await this.sessions.update(session.id, { status: "active", activeAgent: null })) ?? session;
    this.audit?.({ action: "handoff.released", outcome: "success", ...(operator !== undefined && { actorName: operator }), target: session.id, metadata: { channel: session.channel } });
    return released;
  }

  async #session(id: string): Promise<Session> {
    const session = await this.sessions.get(id);
    if (session === undefined) throw new HandoffError("session_not_found", "Session not found");
    return session;
  }
}
