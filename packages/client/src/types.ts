/** Wire types of the /v1 API (see GET /v1/openapi.json). */

export type Language = "bn" | "bn-en" | "en";
export type RunStatus = "completed" | "limited" | "error" | "aborted" | "handoff";

export interface Session {
  id: string;
  channel: string;
  agentId: string;
  status: "active" | "handoff";
  activeAgent?: string;
  handoffReason?: string;
  handoffAt?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  role: "user" | "assistant" | "operator" | "tool" | "system";
  content: string;
  toolCalls?: { id?: string; name: string; args: unknown }[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  tool: string;
  input: unknown;
  status: "ok" | "denied" | "invalid_input" | "invalid_output" | "error" | "unknown_tool";
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface Run {
  id: string;
  sessionId: string;
  status: RunStatus;
  stopReason?: "completed" | "tool_limit" | "iteration_limit" | "handoff";
  language: Language;
  skills: string[];
  agent: string;
  agentPath: string[];
  handoffReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  input: string;
  output?: string;
  error?: string;
  provider: string;
  promptVersion: string;
  iterations: number;
  toolCalls: ToolCall[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface RunResponse {
  sessionId: string;
  sessionCreated?: boolean;
  reply: string;
  run: Run;
}

/** Events of a streamed run (SSE `event:` names). */
export type StreamEvent =
  | { event: "session"; data: { sessionId: string; created: boolean } }
  | { event: "run_start"; data: { runId: string; sessionId: string; language: Language; skills: string[]; agent: string } }
  | { event: "token"; data: { runId: string; text: string } }
  | { event: "tool_start"; data: { runId: string; toolCallId: string; tool: string; input: unknown } }
  | { event: "tool_end"; data: { runId: string; audit: { tool: string; status: ToolCall["status"]; output?: unknown; error?: string; durationMs: number } } }
  | { event: "agent_transfer"; data: { runId: string; from: string; to: string } }
  | { event: "handoff"; data: { runId: string; reason: string; pending: boolean } }
  | { event: "final"; data: { runId: string; text: string } }
  | { event: "error"; data: { runId?: string; message: string; code?: string } }
  | { event: "done"; data: { sessionId: string; run: Run } };

/** Pushed while following a session (GET /v1/sessions/:id/events or WebSocket subscribe). */
export type SessionEvent =
  | { type: "operator_message"; sessionId: string; text: string; at: string }
  | { type: "handoff_released"; sessionId: string; at: string };

export interface Me {
  user: { id: string; name: string; role: "user" | "operator" | "admin" };
  key: { id: string; name: string; scopes: ("read" | "run")[]; createdAt: string };
}

export interface KnowledgeHit {
  source: string;
  title: string;
  chunkIndex: number;
  score: number;
  text: string;
}

export interface Memory {
  id: string;
  text: string;
  createdAt: string;
}

export interface AuditEvent {
  id?: string;
  at: string;
  action: string;
  outcome: "success" | "failure" | "denied";
  actorId?: string;
  actorName?: string;
  target?: string;
  ip?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface AdminStats {
  days: number;
  timezone: string;
  since: string;
  until: string;
  totalCostUsd?: number;
  totals: { runs: number; completed: number; errors: number; limited: number; aborted: number; handoffs: number; inputTokens: number; outputTokens: number; avgDurationMs: number; sessions: number };
  daily: { date: string; runs: number; errors: number; handoffs: number; inputTokens: number; outputTokens: number }[];
  byChannel: { channel: string; runs: number }[];
  byProvider: { provider: string; runs: number; inputTokens: number; outputTokens: number; costUsd?: number }[];
  byAgent: { agent: string; runs: number }[];
  topTools: { tool: string; calls: number; failures: number }[];
}

export interface AdminSession extends Session {
  userId?: string;
  userName?: string;
  messageCount: number;
}

export interface AdminKey {
  id: string;
  name: string;
  scopes: ("read" | "run")[];
  user: string;
  role: "user" | "operator" | "admin";
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}
