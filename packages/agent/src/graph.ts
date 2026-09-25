import { END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { AIMessage, SystemMessage, ToolMessage, type AIMessageChunk } from "@langchain/core/messages";
import { transferToolName, type AgentProfile } from "@banglaclaw/agents";
import type { RunEvent, ToolAuditEvent, ToolSpec } from "@banglaclaw/shared";
import type { ModelProvider } from "@banglaclaw/providers";
import type { Skill } from "@banglaclaw/skills";
import { executeTool, type AnyTool, type PermissionPolicy, type ToolRegistry } from "@banglaclaw/tools";
import { detectLanguage } from "./language.js";
import { HANDOFF_MESSAGES, LIMIT_MESSAGES, buildSystemPrompt, teamRole } from "./prompts.js";
import { AgentStateAnnotation, type AgentState, type AgentStateUpdate } from "./state.js";

export const SUPERVISOR = "supervisor";
export const REQUEST_HUMAN_TOOL = "request_human";

export interface RunLimits {
  /** Maximum model calls per run. */
  maxIterations: number;
  /** Maximum tool executions per run. */
  maxToolCalls: number;
}

export interface TeamOptions {
  /** Specialists from AGENT.md files. Empty = single agent. */
  profiles: readonly AgentProfile[];
  /** Offer request_human (human handoff). */
  handoff: boolean;
  /** Maximum agent transfers per run (prevents ping-pong). */
  maxTransfers: number;
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
  /** Context blocks added to the system prompt (from context providers). */
  context?: readonly string[];
  team?: TeamOptions;
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

const controlSpec = (name: string, description: string, reasonRequired: boolean): ToolSpec => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties: { reason: { type: "string", description: "Short reason, in English" } },
      ...(reasonRequired && { required: ["reason"] }),
      additionalProperties: false,
    },
  },
});

interface AgentView {
  name: string;
  tools: AnyTool[];
  specs: ToolSpec[];
  /** Control tool name → target agent. */
  transfers: Map<string, string>;
  profile?: AgentProfile;
}

/**
 * Graph (single agent = a team with no specialists):
 *
 *   START → prepare → model ─┬─ tool calls, within limits ─→ tools ─┬─ handoff requested → handoff → END
 *                            │                                      └─ otherwise ─────────→ model
 *                            ├─ tool calls, limit reached ──→ limit → END
 *                            └─ no tool calls ──────────────→ finalize → END
 *
 * Each model call uses the active agent's prompt and tool subset. Transfers
 * (`transfer_to_<agent>`) and `request_human` are control tools handled here, not in the registry.
 */
export function buildAgentGraph(options: AgentGraphOptions) {
  const { runId, provider, registry, policy, limits, signal, emit, onAudit } = options;
  const skills = options.skills ?? [];
  const team: TeamOptions = options.team ?? { profiles: [], handoff: false, maxTransfers: 0 };
  const profiles = new Map(team.profiles.map((p) => [p.name, p]));

  // Only advertise tools the policy allows; executeTool re-checks every call regardless.
  const allowed: AnyTool[] = registry.list().filter((t) => policy.check(t).allowed);

  const views = new Map<string, AgentView>();
  const viewFor = (agent: string): AgentView => {
    const cached = views.get(agent);
    if (cached !== undefined) return cached;
    const profile = profiles.get(agent);
    // With specialists, the supervisor keeps only tools no specialist claims, so domain requests get routed.
    const claimed = new Set(team.profiles.flatMap((p) => p.tools));
    const tools =
      profile !== undefined ? allowed.filter((t) => profile.tools.includes(t.name)) : allowed.filter((t) => !claimed.has(t.name));
    const transfers = new Map<string, string>();
    const control: ToolSpec[] = [];
    if (profile === undefined) {
      for (const p of team.profiles) {
        transfers.set(transferToolName(p.name), p.name);
        control.push(controlSpec(transferToolName(p.name), `Transfer the conversation to the ${p.name} specialist: ${p.description}`, false));
      }
    } else {
      transfers.set(transferToolName(SUPERVISOR), SUPERVISOR);
      control.push(controlSpec(transferToolName(SUPERVISOR), "Transfer the conversation back to the front-desk supervisor when the request is outside your area.", false));
    }
    if (team.handoff) control.push(controlSpec(REQUEST_HUMAN_TOOL, "Hand the conversation to a human operator. The bot stops replying until the operator releases it.", true));
    for (const spec of control) {
      if (registry.get(spec.function.name) !== undefined) throw new Error(`Tool name ${spec.function.name} is reserved for agent control`);
    }
    const view: AgentView = { name: agent, tools, specs: [...registry.toSpecs(tools), ...control], transfers, ...(profile !== undefined && { profile }) };
    views.set(agent, view);
    return view;
  };

  const prepare = (state: AgentState): AgentStateUpdate => {
    const start = profiles.has(state.activeAgent) ? state.activeAgent : SUPERVISOR;
    return { language: detectLanguage(state.input), skills: skills.map((s) => s.name), activeAgent: start, agentPath: [start] };
  };

  const model = async (state: AgentState): Promise<AgentStateUpdate> => {
    const view = viewFor(state.activeAgent);
    const agentSkills = view.profile?.skills === undefined ? skills : skills.filter((s) => view.profile?.skills?.includes(s.name));
    const system = new SystemMessage(
      buildSystemPrompt({
        agentName: options.agentName,
        language: state.language,
        toolNames: view.specs.map((s) => s.function.name),
        timezone: options.timezone,
        skills: agentSkills,
        context: options.context ?? [],
        ...withRole(
          teamRole({
            agent: state.activeAgent,
            specialists: team.profiles.map((p) => ({ name: p.name, description: p.description })),
            ...(view.profile !== undefined && { instructions: view.profile.instructions }),
            transferTool: transferToolName,
            handoff: team.handoff,
          }),
        ),
      }),
    );

    let merged: AIMessageChunk | undefined;
    for await (const chunk of provider.stream([system, ...state.messages], { tools: view.specs, signal })) {
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
    const view = viewFor(state.activeAgent);
    const regular = calls.filter((c) => !view.transfers.has(c.name) && c.name !== REQUEST_HUMAN_TOOL).length;
    if (state.toolCallCount + regular > limits.maxToolCalls) return "limit";
    if (state.iterations >= limits.maxIterations) return "limit";
    return "tools";
  };

  const tools = async (state: AgentState): Promise<AgentStateUpdate> => {
    const calls = lastAiMessage(state)?.tool_calls ?? [];
    const view = viewFor(state.activeAgent);
    const allowedNames = new Set(view.tools.map((t) => t.name));
    // An agent may only run its own tool subset, whatever the model asks for.
    const scoped: PermissionPolicy = {
      check: (tool) => (allowedNames.has(tool.name) ? policy.check(tool) : { allowed: false, reason: `Tool "${tool.name}" is not available to agent ${view.name}` }),
    };

    const messages: ToolMessage[] = [];
    let activeAgent = state.activeAgent;
    let agentPath = state.agentPath;
    let transfers = state.transfers;
    let handoffReason = state.handoffReason;
    let regular = 0;
    let stopped: string | undefined;

    const control = (id: string, name: string, args: unknown, output: unknown, error?: string) => {
      const audit: ToolAuditEvent = { runId, toolCallId: id, tool: name, input: args, status: error === undefined ? "ok" : "error", durationMs: 0, ...(error === undefined ? { output } : { error }) };
      onAudit(audit);
      emit({ type: "tool_end", runId, audit });
      messages.push(new ToolMessage({ tool_call_id: id, name, content: JSON.stringify(error === undefined ? output : { error: "control", message: error }) }));
    };

    for (const [i, call] of calls.entries()) {
      const id = call.id ?? `${runId}_tool_${state.toolCallCount + i}`;
      if (stopped !== undefined) {
        messages.push(new ToolMessage({ tool_call_id: id, name: call.name, content: JSON.stringify({ error: "skipped", message: stopped }) }));
        continue;
      }
      emit({ type: "tool_start", runId, toolCallId: id, tool: call.name, input: call.args });

      const target = view.transfers.get(call.name);
      if (target !== undefined) {
        if (transfers >= team.maxTransfers) {
          control(id, call.name, call.args, undefined, `Transfer limit reached (${team.maxTransfers}); answer the user yourself`);
        } else {
          emit({ type: "agent_transfer", runId, from: activeAgent, to: target });
          control(id, call.name, call.args, { transferred_to: target });
          activeAgent = target;
          agentPath = [...agentPath, target];
          transfers += 1;
          stopped = `Conversation transferred to ${target}`;
        }
        continue;
      }
      if (call.name === REQUEST_HUMAN_TOOL && team.handoff) {
        const reason = typeof call.args.reason === "string" && call.args.reason.trim() !== "" ? call.args.reason.trim().slice(0, 300) : "User needs a human";
        handoffReason = reason;
        emit({ type: "handoff", runId, reason, pending: false });
        control(id, call.name, call.args, { handoff: true });
        stopped = "Conversation handed to a human";
        continue;
      }

      regular += 1;
      const result = await executeTool(
        { id, name: call.name, args: call.args },
        { registry, policy: scoped, ctx: { runId, sessionId: state.sessionId, timezone: options.timezone, signal }, onAudit },
      );
      emit({ type: "tool_end", runId, audit: result.audit });
      messages.push(new ToolMessage({ tool_call_id: id, name: call.name, content: result.content }));
    }
    return { messages, toolCallCount: state.toolCallCount + regular, activeAgent, agentPath, transfers, handoffReason };
  };

  const afterTools = (state: AgentState): "handoff" | "model" => (state.handoffReason !== undefined ? "handoff" : "model");

  const handoff = (state: AgentState): AgentStateUpdate => {
    const text = HANDOFF_MESSAGES[state.language];
    emit({ type: "token", runId, text });
    emit({ type: "final", runId, text });
    return { messages: [new AIMessage(text)], response: text, stopReason: "handoff" };
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
    .addNode("handoff", handoff)
    .addNode("limit", limit)
    .addNode("finalize", finalize)
    .addEdge(START, "prepare")
    .addEdge("prepare", "model")
    .addConditionalEdges("model", route, ["tools", "limit", "finalize"])
    .addConditionalEdges("tools", afterTools, ["handoff", "model"])
    .addEdge("handoff", END)
    .addEdge("limit", END)
    .addEdge("finalize", END)
    .compile(options.checkpointer !== undefined ? { checkpointer: options.checkpointer } : {});
}

function withRole(role: string | undefined): { role?: string } {
  return role !== undefined ? { role } : {};
}
