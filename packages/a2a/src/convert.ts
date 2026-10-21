import { randomUUID } from "node:crypto";
import { Role, TaskState, type AgentCard, type Message, type Part, type Task } from "@a2a-js/sdk";

export const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const MAX_DESCRIPTION = 1024;
const MAX_SKILLS = 10;

/** BanglaClaw tool name for a configured remote agent. Agent names are already lower snake_case. */
export const toolNameFor = (agent: string): string => `a2a__${agent}`;

/** A message for the remote agent; `taskId` continues a task that is waiting for input. */
export function userMessage(text: string, contextId = "", taskId = ""): Message {
  return {
    messageId: randomUUID(),
    contextId,
    taskId,
    role: Role.ROLE_USER,
    parts: [{ content: { $case: "text", value: text }, metadata: undefined, filename: "", mediaType: "text/plain" }],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

/** Text the model can read: text parts as they are, data parts as JSON, files as a short marker. */
export function partsText(parts: readonly Part[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    const content = part.content;
    if (content === undefined) continue;
    switch (content.$case) {
      case "text":
        chunks.push(content.value);
        break;
      case "data":
        chunks.push(JSON.stringify(content.value));
        break;
      case "url":
        chunks.push(`[file ${part.filename || content.value}${part.mediaType ? ` ${part.mediaType}` : ""}: ${content.value}]`);
        break;
      case "raw":
        chunks.push(`[file ${part.filename || "attachment"}${part.mediaType ? ` ${part.mediaType}` : ""}, ${content.value.length} bytes, not shown]`);
        break;
    }
  }
  return chunks.join("\n").trim();
}

export function isTask(result: Message | Task): result is Task {
  return "status" in result && "artifacts" in result;
}

export const WAITING_STATES: ReadonlySet<TaskState> = new Set([TaskState.TASK_STATE_UNSPECIFIED, TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING]);

export type ReplyState = "completed" | "input-required";

/** Text of a task so far: its artifacts, else its status message. */
export function taskText(task: Task): string {
  const artifacts = task.artifacts.map((a) => partsText(a.parts)).filter((t) => t !== "").join("\n\n");
  if (artifacts !== "") return artifacts;
  return task.status?.message !== undefined ? partsText(task.status.message.parts) : "";
}

/** The remote result as tool output, or the reason it failed. */
export function replyOf(result: Message | Task): { reply: string; state: ReplyState; note?: string } | { error: string } {
  if (!isTask(result)) return { reply: partsText(result.parts), state: "completed" };
  const artifacts = result.artifacts.map((a) => partsText(a.parts)).filter((t) => t !== "").join("\n\n");
  const status = result.status?.message !== undefined ? partsText(result.status.message.parts) : "";
  const state = result.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED;
  switch (state) {
    case TaskState.TASK_STATE_COMPLETED:
      return artifacts !== "" ? { reply: artifacts, state: "completed", ...(status !== "" && { note: status }) } : { reply: status, state: "completed" };
    case TaskState.TASK_STATE_INPUT_REQUIRED:
      // The agent asks a question (or a human operator took over); the next call answers it.
      return { reply: status !== "" ? status : artifacts !== "" ? artifacts : "The agent needs more input.", state: "input-required", ...(status !== "" && artifacts !== "" && { note: artifacts }) };
    case TaskState.TASK_STATE_FAILED:
      return { error: `the task failed${status !== "" ? `: ${status}` : ""}` };
    case TaskState.TASK_STATE_REJECTED:
      return { error: `the task was rejected${status !== "" ? `: ${status}` : ""}` };
    case TaskState.TASK_STATE_CANCELED:
      return { error: "the task was cancelled" };
    case TaskState.TASK_STATE_AUTH_REQUIRED:
      return { error: "the agent requires authentication BanglaClaw cannot provide" };
    default:
      return { error: `the task ended in an unknown state (${state})` };
  }
}

/**
 * Tool description for the model. The card is remote, untrusted text, so the operator's
 * `description` wins when set; either way it is capped.
 */
export function describeAgent(agent: string, card: AgentCard, override?: string): string {
  const skills = card.skills.slice(0, MAX_SKILLS).map((s) => s.name || s.id);
  const about = override ?? [card.description.trim(), skills.length > 0 ? `Skills: ${skills.join(", ")}.` : ""].filter((s) => s !== "").join(" ");
  const usage =
    "Send a self-contained message; follow-ups in this conversation keep the remote agent's context. A result with state input-required is the agent's question: the next call answers it (set newTask to start over instead).";
  return `[A2A ${agent}] ${about || card.name}`.slice(0, MAX_DESCRIPTION - usage.length - 1) + ` ${usage}`;
}

export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  return text.length > maxChars ? { text: `${text.slice(0, maxChars)}\n…[truncated]`, truncated: true } : { text, truncated: false };
}
