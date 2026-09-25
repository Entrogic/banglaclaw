import type { BaseMessage } from "@langchain/core/messages";
import { isOperatorMessage, type RunRecord, type Session } from "@banglaclaw/session";

/** Channel-native ids are namespaced per user so two API users can't collide or probe each other. */
export function scopedExternalId(userId: string, externalId: string): string {
  return `${userId}/${externalId}`;
}

export function sessionJson(s: Session) {
  const prefix = s.userId !== undefined ? `${s.userId}/` : "";
  return {
    id: s.id,
    channel: s.channel,
    agentId: s.agentId,
    status: s.status,
    ...(s.activeAgent !== undefined && { activeAgent: s.activeAgent }),
    ...(s.handoffReason !== undefined && { handoffReason: s.handoffReason }),
    ...(s.handoffAt !== undefined && { handoffAt: s.handoffAt.toISOString() }),
    ...(s.externalId !== undefined && { externalId: s.externalId.startsWith(prefix) ? s.externalId.slice(prefix.length) : s.externalId }),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function runJson(r: RunRecord) {
  return {
    id: r.id,
    sessionId: r.sessionId,
    status: r.status,
    ...(r.stopReason !== undefined && { stopReason: r.stopReason }),
    language: r.language,
    skills: r.skills,
    agent: r.agent,
    agentPath: r.agentPath,
    ...(r.handoffReason !== undefined && { handoffReason: r.handoffReason }),
    ...(r.usage !== undefined && { usage: r.usage }),
    input: r.input,
    ...(r.output !== undefined && { output: r.output }),
    ...(r.error !== undefined && { error: r.error }),
    provider: r.provider,
    promptVersion: r.promptVersion,
    iterations: r.iterations,
    toolCalls: r.toolCalls.map((c) => ({
      id: c.toolCallId,
      tool: c.tool,
      input: c.input,
      status: c.status,
      ...(c.output !== undefined && { output: c.output }),
      ...(c.error !== undefined && { error: c.error }),
      durationMs: c.durationMs,
    })),
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt.toISOString(),
    durationMs: r.durationMs,
  };
}

export function messageJson(m: BaseMessage) {
  const type = m.getType();
  const toolCalls = "tool_calls" in m && Array.isArray(m.tool_calls) ? (m.tool_calls as { id?: string; name: string; args: unknown }[]) : [];
  return {
    role: type === "human" ? "user" : isOperatorMessage(m) ? "operator" : type === "ai" ? "assistant" : type,
    content: m.text,
    ...(toolCalls.length > 0 && { toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })) }),
    ...("tool_call_id" in m && typeof m.tool_call_id === "string" && { toolCallId: m.tool_call_id }),
  };
}
