import { setTimeout as sleep } from "node:timers/promises";
import type { Client } from "@a2a-js/sdk/client";
import type { Artifact, Message, StreamResponse, Task } from "@a2a-js/sdk";
import { z } from "zod";
import { ToolExecutionError } from "@entrogic-net/shared";
import { defineTool, type AnyTool } from "@entrogic-net/tools";
import { DEFAULT_MAX_OUTPUT_CHARS, WAITING_STATES, isTask, replyOf, taskText, toolNameFor, truncate, userMessage } from "./convert.js";
import { Conversations } from "./conversations.js";

export const A2aToolInputSchema = z.strictObject({
  message: z.string().trim().min(1).max(20_000).describe("The message for the remote agent, in any language"),
  newTask: z.boolean().optional().describe("Start a new task instead of answering the agent's pending question"),
});

export const A2aToolOutputSchema = z.strictObject({
  agent: z.string(),
  reply: z.string(),
  /** `input-required`: the reply is the agent's question, and the next call answers it. */
  state: z.enum(["completed", "input-required"]),
  /** The remote status message, when the reply came as an artifact. */
  note: z.string().optional(),
  truncated: z.boolean(),
});
export type A2aToolOutput = z.infer<typeof A2aToolOutputSchema>;

export interface A2aToolOptions {
  agent: string;
  description: string;
  client: Client;
  timeoutMs: number;
  conversations: Conversations;
  maxOutputChars?: number;
  /** Delay between GetTask polls when the agent answers before the task is done. */
  pollIntervalMs?: number;
}

/**
 * One configured remote agent as a BanglaClawTool (docs/25). Each BanglaClaw session gets its own
 * remote conversation (the `contextId` the agent returned), so follow-ups keep their context; a
 * task that ends `input-required` is continued by the session's next call. Agents that stream
 * report their partial reply through `ctx.progress`.
 */
export function a2aAgentTool(options: A2aToolOptions): AnyTool {
  const { agent, client, conversations } = options;
  const poll = options.pollIntervalMs ?? 1_000;
  const maxChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  return defineTool({
    name: toolNameFor(agent),
    description: options.description,
    // Messages leave this process for another service.
    risk: "sensitive",
    timeoutMs: options.timeoutMs,
    inputSchema: A2aToolInputSchema,
    outputSchema: A2aToolOutputSchema,
    async execute(input, ctx): Promise<A2aToolOutput> {
      const { signal } = ctx;
      const conversation = conversations.get(ctx.sessionId);
      const pendingTaskId = input.newTask === true ? undefined : conversation?.pendingTaskId;
      const message = userMessage(input.message, conversation?.contextId, pendingTaskId);
      // SDK falls back to a blocking SendMessage when the card does not advertise streaming.
      const stream = new TaskStream((text) => ctx.progress?.(truncate(text, maxChars).text));

      try {
        for await (const event of client.sendMessageStream({ tenant: "", message, configuration: undefined, metadata: undefined }, { signal })) stream.apply(event);
        let result = stream.result;
        if (result === undefined) throw new ToolExecutionError(`A2A agent ${agent}: no response`);
        // Streams normally end in a final or interrupted state; poll servers that stop earlier.
        while (isTask(result) && WAITING_STATES.has(result.status?.state ?? 0)) {
          await sleep(poll, undefined, { signal });
          result = await client.getTask({ tenant: "", id: result.id, historyLength: 0 }, { signal });
          stream.taskId = result.id;
        }

        const outcome = replyOf(result);
        const contextId = result.contextId !== "" ? result.contextId : conversation?.contextId;
        if (contextId !== undefined) {
          conversations.set(ctx.sessionId, { contextId, ...("state" in outcome && outcome.state === "input-required" && isTask(result) && { pendingTaskId: result.id }) });
        }
        if ("error" in outcome) throw new ToolExecutionError(`A2A agent ${agent}: ${outcome.error.slice(0, 500)}`);

        const { text, truncated } = truncate(outcome.reply, maxChars);
        return { agent, reply: text, state: outcome.state, ...(outcome.note !== undefined && { note: outcome.note.slice(0, 2_000) }), truncated };
      } catch (error) {
        if (signal.aborted) {
          if (stream.taskId !== undefined) await client.cancelTask({ tenant: "", id: stream.taskId, metadata: undefined }).catch(() => {});
          throw error;
        }
        if (pendingTaskId !== undefined && !(error instanceof ToolExecutionError)) {
          // The remote agent may have forgotten the task (a restart); the next call starts a new one.
          if (conversation !== undefined) conversations.set(ctx.sessionId, { contextId: conversation.contextId });
          const reason = error instanceof Error ? error.message : String(error);
          throw new ToolExecutionError(`A2A agent ${agent}: the pending task could not be continued (${reason.slice(0, 300)}); call again to start a new task`);
        }
        throw error;
      }
    },
  });
}

/**
 * Folds a stream of A2A events into the latest task (or the agent's direct message), reporting the
 * reply so far whenever it changes. Artifact chunks with `append` extend the artifact with the same id.
 */
class TaskStream {
  #task: Task | undefined;
  #message: Message | undefined;
  #reported = "";
  taskId: string | undefined;

  constructor(private readonly report: (text: string) => void) {}

  get result(): Message | Task | undefined {
    return this.#message ?? this.#task;
  }

  apply(event: StreamResponse): void {
    const payload = event.payload;
    if (payload === undefined) return;
    switch (payload.$case) {
      case "message":
        this.#message = payload.value;
        return;
      case "task":
        this.#task = { ...payload.value, artifacts: [...payload.value.artifacts] };
        break;
      case "statusUpdate": {
        const task = this.#ensure(payload.value.taskId, payload.value.contextId);
        task.status = payload.value.status;
        break;
      }
      case "artifactUpdate": {
        const { artifact, append } = payload.value;
        if (artifact === undefined) return;
        const task = this.#ensure(payload.value.taskId, payload.value.contextId);
        const index = task.artifacts.findIndex((a) => a.artifactId === artifact.artifactId);
        const existing = index === -1 ? undefined : task.artifacts[index];
        const next: Artifact = append && existing !== undefined ? { ...existing, parts: [...existing.parts, ...artifact.parts] } : artifact;
        if (index === -1) task.artifacts.push(next);
        else task.artifacts[index] = next;
        break;
      }
    }
    if (this.#task === undefined) return;
    this.taskId = this.#task.id;
    const text = taskText(this.#task);
    if (text !== "" && text !== this.#reported) {
      this.#reported = text;
      this.report(text);
    }
  }

  #ensure(taskId: string, contextId: string): Task {
    this.#task ??= { id: taskId, contextId, status: undefined, artifacts: [], history: [], metadata: undefined };
    return this.#task;
  }
}
