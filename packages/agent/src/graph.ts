import { END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { AIMessage, SystemMessage, ToolMessage, type AIMessageChunk } from "@langchain/core/messages";
import type { RunEvent, ToolAuditEvent } from "@banglaclaw/shared";
import type { ModelProvider } from "@banglaclaw/providers";
import type { Skill } from "@banglaclaw/skills";
import { executeTool, type AnyTool, type PermissionPolicy, type ToolRegistry } from "@banglaclaw/tools";
import { detectLanguage } from "./language.js";
import { LIMIT_MESSAGES, buildSystemPrompt } from "./prompts.js";
import { AgentStateAnnotation, type AgentState, type AgentStateUpdate } from "./state.js";

export interface RunLimits {
  /** Maximum model calls per run. */
  maxIterations: number;
  /** Maximum tool executions per run. */
  maxToolCalls: number;
}

export interface AgentGraphOptions {
  runId: string;
  agentName: string;
  timezone: string;
  provider: ModelProvider;
  registry: ToolRegistry;
  policy: PermissionPolicy;
  limits: RunLimits;
  /** Skills activated for this run (selected by the runtime). */
  skills?: readonly Skill[];
  /** Persists graph state per run (thread_id = runId) when provided. */
  checkpointer?: BaseCheckpointSaver;
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
  onAudit: (event: ToolAuditEvent) => void;
}

function lastAiMessage(state: AgentState): AIMessage | undefined {
  const last = state.messages.at(-1);
  return last instanceof AIMessage ? last : undefined;
}

/**
 * v0.1 graph:
 *
 *   START → prepare → model ─┬─ tool calls, within limits ─→ tools → model
 *                            ├─ tool calls, limit reached ──→ limit → END
 *                            └─ no tool calls ──────────────→ finalize → END
 */
export function buildAgentGraph(options: AgentGraphOptions) {
  const { runId, provider, registry, policy, limits, signal, emit, onAudit } = options;
  const skills = options.skills ?? [];

  // Only advertise tools the policy allows; executeTool re-checks every call regardless.
  const allowedTools: AnyTool[] = registry.list().filter((t) => policy.check(t).allowed);
  const toolSpecs = registry.toSpecs(allowedTools);

  const prepare = (state: AgentState): AgentStateUpdate => ({
    language: detectLanguage(state.input),
    skills: skills.map((s) => s.name),
  });

  const model = async (state: AgentState): Promise<AgentStateUpdate> => {
    const system = new SystemMessage(
      buildSystemPrompt({
        agentName: options.agentName,
        language: state.language,
        toolNames: allowedTools.map((t) => t.name),
        timezone: options.timezone,
        skills,
      }),
    );

    let merged: AIMessageChunk | undefined;
    for await (const chunk of provider.stream([system, ...state.messages], { tools: toolSpecs, signal })) {
      const text = chunk.text;
      if (text.length > 0) emit({ type: "token", runId, text });
      merged = merged === undefined ? chunk : merged.concat(chunk);
    }

    const message = new AIMessage({
      content: merged?.content ?? "",
      tool_calls: merged?.tool_calls ?? [],
      ...(merged?.id !== undefined && { id: merged.id }),
      ...(merged?.usage_metadata !== undefined && { usage_metadata: merged.usage_metadata }),
    });
    return { messages: [message], iterations: state.iterations + 1 };
  };

  const route = (state: AgentState): "tools" | "limit" | "finalize" => {
    const calls = lastAiMessage(state)?.tool_calls ?? [];
    if (calls.length === 0) return "finalize";
    if (state.toolCallCount + calls.length > limits.maxToolCalls) return "limit";
    if (state.iterations >= limits.maxIterations) return "limit";
    return "tools";
  };

  const tools = async (state: AgentState): Promise<AgentStateUpdate> => {
    const calls = lastAiMessage(state)?.tool_calls ?? [];
    const messages: ToolMessage[] = [];
    for (const [i, call] of calls.entries()) {
      const id = call.id ?? `${runId}_tool_${state.toolCallCount + i}`;
      emit({ type: "tool_start", runId, toolCallId: id, tool: call.name, input: call.args });
      const result = await executeTool(
        { id, name: call.name, args: call.args },
        {
          registry,
          policy,
          ctx: { runId, sessionId: state.sessionId, timezone: options.timezone, signal },
          onAudit,
        },
      );
      emit({ type: "tool_end", runId, audit: result.audit });
      messages.push(new ToolMessage({ tool_call_id: id, name: call.name, content: result.content }));
    }
    return { messages, toolCallCount: state.toolCallCount + calls.length };
  };

  const limit = (state: AgentState): AgentStateUpdate => {
    const last = lastAiMessage(state);
    // Close every dangling tool call so the stored history stays valid for the next turn.
    const skipped = (last?.tool_calls ?? []).map(
      (call) =>
        new ToolMessage({
          tool_call_id: call.id ?? "",
          name: call.name,
          content: JSON.stringify({ error: "skipped", message: "Run limit reached before this tool call" }),
        }),
    );
    const text = LIMIT_MESSAGES[state.language];
    emit({ type: "token", runId, text: (last?.text.length ?? 0) > 0 ? `\n\n${text}` : text });
    emit({ type: "final", runId, text });
    const toolLimited = state.toolCallCount + (last?.tool_calls?.length ?? 0) > limits.maxToolCalls;
    return {
      messages: [...skipped, new AIMessage(text)],
      response: text,
      stopReason: toolLimited ? "tool_limit" : "iteration_limit",
    };
  };

  const finalize = (state: AgentState): AgentStateUpdate => {
    const text = lastAiMessage(state)?.text ?? "";
    emit({ type: "final", runId, text });
    return { response: text, stopReason: "completed" };
  };

  return new StateGraph(AgentStateAnnotation)
    .addNode("prepare", prepare)
    .addNode("model", model)
    .addNode("tools", tools)
    .addNode("limit", limit)
    .addNode("finalize", finalize)
    .addEdge(START, "prepare")
    .addEdge("prepare", "model")
    .addConditionalEdges("model", route, ["tools", "limit", "finalize"])
    .addEdge("tools", "model")
    .addEdge("limit", END)
    .addEdge("finalize", END)
    .compile(options.checkpointer !== undefined ? { checkpointer: options.checkpointer } : {});
}
