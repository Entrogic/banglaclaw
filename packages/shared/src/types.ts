/** Detected input language: Bangla script, Banglish (romanised Bangla / code-mixed), or English. */
export type Language = "bn" | "bn-en" | "en";

/** Common channel-agnostic inbound message (docs/11). */
export interface IncomingMessage {
  channel: string;
  sessionId: string;
  userId?: string;
  text: string;
  receivedAt: Date;
}

/** Common channel-agnostic outbound message (docs/11). */
export interface OutgoingMessage {
  channel: string;
  sessionId: string;
  text: string;
  language: Language;
}

export interface ToolAuditEvent {
  runId: string;
  toolCallId: string;
  tool: string;
  input: unknown;
  status: "ok" | "denied" | "invalid_input" | "invalid_output" | "error" | "unknown_tool";
  output?: unknown;
  error?: string;
  durationMs: number;
}

/** Why an agent graph stopped. */
export type StopReason = "completed" | "tool_limit" | "iteration_limit" | "handoff";

/** Events streamed from an agent run to its caller. */
export type RunEvent =
  | { type: "run_start"; runId: string; sessionId: string; language: Language; skills: string[]; agent: string }
  | { type: "agent_transfer"; runId: string; from: string; to: string }
  | { type: "handoff"; runId: string; reason: string; pending: boolean }
  | { type: "token"; runId: string; text: string }
  | { type: "tool_start"; runId: string; toolCallId: string; tool: string; input: unknown }
  | { type: "tool_end"; runId: string; audit: ToolAuditEvent }
  | { type: "final"; runId: string; text: string }
  | { type: "error"; runId: string; message: string };

/** Provider-neutral tool description in OpenAI function format (accepted by OpenAI- and Anthropic-backed chat models). */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
