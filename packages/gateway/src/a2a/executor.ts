import { randomUUID } from "node:crypto";
import { Role, TaskState, type Artifact, type Message, type Part, type Task } from "@a2a-js/sdk";
import { AgentEvent, type AgentExecutor, type ExecutionEventBus, type RequestContext, type ServerCallContext, type User } from "@a2a-js/sdk/server";
import { AgentRunError } from "@entrogic-net/agent";
import type { Principal } from "@entrogic-net/auth";
import type { RunRecord, Session } from "@entrogic-net/session";
import type { Logger } from "@entrogic-net/shared";
import type { GatewayContext } from "../context.js";
import { scopedExternalId } from "../serialize.js";

/** Session channel for conversations that arrive over A2A. */
export const A2A_CHANNEL = "a2a";
const MAX_CONTEXT_ID = 200;

/** The authenticated API key behind an A2A call. Tasks are stored per user (`userName`). */
export class PrincipalUser implements User {
  constructor(readonly principal: Principal) {}
  get isAuthenticated(): boolean {
    return true;
  }
  get userName(): string {
    return this.principal.user.id;
  }
}

const now = () => new Date().toISOString();
const textPart = (text: string): Part => ({ content: { $case: "text", value: text }, metadata: undefined, filename: "", mediaType: "text/plain" });

function agentMessage(taskId: string, contextId: string, text: string): Message {
  return { messageId: randomUUID(), contextId, taskId, role: Role.ROLE_AGENT, parts: [textPart(text)], metadata: undefined, extensions: [], referenceTaskIds: [] };
}

/** Text of the incoming message: text parts as they are, data parts as JSON. Files are not accepted. */
export function messageText(message: Message): { text: string } | { error: string } {
  const chunks: string[] = [];
  for (const part of message.parts) {
    const content = part.content;
    if (content === undefined) continue;
    if (content.$case === "text") chunks.push(content.value);
    else if (content.$case === "data") chunks.push(JSON.stringify(content.value));
    else return { error: "Only text and data parts are supported; files are not accepted over A2A." };
  }
  const text = chunks.join("\n").trim();
  return text === "" ? { error: "The message has no text." } : { text };
}

/** A2A state for a finished run. `cancelled` = our CancelTask aborted it; other aborts are timeouts. */
function finalState(record: RunRecord, cancelled: boolean): { state: TaskState; note?: string } {
  switch (record.status) {
    case "completed":
      return { state: TaskState.TASK_STATE_COMPLETED };
    case "limited":
      return { state: TaskState.TASK_STATE_COMPLETED, note: "Stopped before finishing (step limit reached)." };
    case "handoff":
      return { state: TaskState.TASK_STATE_INPUT_REQUIRED, note: "A human operator is handling this conversation now." };
    case "aborted":
      return cancelled
        ? { state: TaskState.TASK_STATE_CANCELED, note: "The task was cancelled." }
        : { state: TaskState.TASK_STATE_FAILED, note: record.error ?? "The run was stopped." };
    case "error":
      return { state: TaskState.TASK_STATE_FAILED, note: `The agent could not answer: ${record.error ?? "unknown error"}` };
  }
}

/**
 * Runs A2A tasks on the BanglaClaw agent (docs/25). Each A2A `contextId` is one `a2a` session owned
 * by the calling API key's user, so follow-ups share history; runs count against the key's
 * concurrency limit and are recorded like any other run.
 */
export class BanglaClawExecutor implements AgentExecutor {
  readonly #running = new Map<string, { controller: AbortController; contextId: string }>();

  constructor(
    private readonly gw: GatewayContext,
    private readonly logger: Logger,
  ) {}

  execute = async (ctx: RequestContext, bus: ExecutionEventBus): Promise<void> => {
    const { taskId, contextId } = ctx;
    const task: Task = ctx.task ?? { id: taskId, contextId, status: undefined, artifacts: [], history: [ctx.userMessage], metadata: undefined };
    bus.publish(AgentEvent.task({ ...task, status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: now() } }));
    const finish = (state: TaskState, note?: string, metadata?: Record<string, unknown>) => {
      bus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: { state, message: note !== undefined ? agentMessage(taskId, contextId, note) : undefined, timestamp: now() },
          metadata,
        }),
      );
      bus.finished();
    };

    const principal = principalOf(ctx.context);
    const input = messageText(ctx.userMessage);
    if ("error" in input) return finish(TaskState.TASK_STATE_REJECTED, input.error);
    if (input.text.length > this.gw.deps.config.maxInputChars) return finish(TaskState.TASK_STATE_REJECTED, `The message is longer than ${this.gw.deps.config.maxInputChars} characters.`);
    if (contextId.length > MAX_CONTEXT_ID) return finish(TaskState.TASK_STATE_REJECTED, `contextId must be at most ${MAX_CONTEXT_ID} characters.`);

    const release = this.gw.concurrency.acquire(principal.key.id);
    if (release === undefined) return finish(TaskState.TASK_STATE_FAILED, `At most ${this.gw.concurrency.max} runs may be in flight per API key; retry shortly.`);
    const controller = new AbortController();
    this.#running.set(taskId, { controller, contextId });
    try {
      const session = await this.#session(principal, contextId);
      bus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: now() }, metadata: { sessionId: session.id } }));
      let record: RunRecord;
      try {
        record = await this.gw.deps.runtime.run(input.text, { sessionId: session.id, signal: controller.signal });
      } catch (error) {
        if (!(error instanceof AgentRunError)) throw error;
        record = error.record;
      }
      if (record.output !== undefined && record.output !== "") {
        const artifact: Artifact = { artifactId: "response", name: "response", description: "", parts: [textPart(record.output)], metadata: undefined, extensions: [] };
        bus.publish(AgentEvent.artifactUpdate({ taskId, contextId, artifact, append: false, lastChunk: true, metadata: undefined }));
      }
      const { state, note } = finalState(record, controller.signal.aborted);
      finish(state, note, { sessionId: session.id, runId: record.id, language: record.language });
    } catch (error) {
      this.logger.error("A2A task failed", { error, taskId });
      finish(TaskState.TASK_STATE_FAILED, "Internal error");
    } finally {
      this.#running.delete(taskId);
      release();
    }
  };

  /** The request handler only calls this for a task it has loaded for the same user. */
  cancelTask = async (taskId: string, bus: ExecutionEventBus): Promise<void> => {
    const running = this.#running.get(taskId);
    if (running !== undefined) {
      // execute() sees the aborted run and publishes the canceled status.
      running.controller.abort(new Error("Cancelled over A2A"));
      return;
    }
    bus.finished();
  };

  async #session(principal: Principal, contextId: string): Promise<Session> {
    const { sessions, agent } = this.gw.deps;
    const externalId = scopedExternalId(principal.user.id, contextId);
    return (
      (await sessions.findByExternalId(A2A_CHANNEL, externalId)) ??
      sessions.create({ channel: A2A_CHANNEL, agentId: agent.name, userId: principal.user.id, externalId })
    );
  }
}

function principalOf(context: ServerCallContext): Principal {
  const user = context.user;
  if (!(user instanceof PrincipalUser)) throw new Error("A2A call without an authenticated principal");
  return user.principal;
}
