import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

/**
 * Short-term memory window: keeps at most `max` recent messages and drops leading messages
 * until the window starts at a user turn, so it never begins with an orphaned tool result
 * or an assistant tool call whose results were cut off.
 */
export function trimHistory(messages: readonly BaseMessage[], max: number): BaseMessage[] {
  if (max <= 0) return [];
  const window = messages.slice(-max);
  const start = window.findIndex((m) => HumanMessage.isInstance(m));
  return start === -1 ? [] : window.slice(start);
}

/** True if every assistant tool call in `messages` has a matching tool result. */
export function hasCompleteToolCalls(messages: readonly BaseMessage[]): boolean {
  const pending = new Set<string>();
  for (const m of messages) {
    if (AIMessage.isInstance(m)) for (const call of m.tool_calls ?? []) if (call.id !== undefined) pending.add(call.id);
    if (m.getType() === "tool" && "tool_call_id" in m && typeof m.tool_call_id === "string") pending.delete(m.tool_call_id);
  }
  return pending.size === 0;
}
