import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { Language } from "@banglaclaw/shared";

export type StopReason = "completed" | "tool_limit" | "iteration_limit";

const replace = <T>(fallback: () => T) => Annotation<T>({ reducer: (_prev, next) => next, default: fallback });

export const AgentStateAnnotation = Annotation.Root({
  sessionId: replace<string>(() => ""),
  input: replace<string>(() => ""),
  language: replace<Language>(() => "en"),
  /** Conversation history for this session plus messages produced in this run (no system prompt). */
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  iterations: replace<number>(() => 0),
  toolCallCount: replace<number>(() => 0),
  response: replace<string | undefined>(() => undefined),
  stopReason: replace<StopReason | undefined>(() => undefined),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
