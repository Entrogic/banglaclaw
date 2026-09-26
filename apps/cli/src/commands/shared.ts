import type { AgentRuntime } from "@entrogic-net/agent";
import { ApiKeyAuthenticator } from "@entrogic-net/auth";
import type { KnowledgeBase, LongTermMemory } from "@entrogic-net/knowledge";
import type { McpManager } from "@entrogic-net/mcp";
import { HandoffDesk, InMemorySessionStore, SessionManager, isOperatorMessage, type Session } from "@entrogic-net/session";
import { BanglaClawError, auditRecorder, createLogger, parseLogLevel, type LoadedConfig } from "@entrogic-net/shared";
import type { BaseMessage } from "@langchain/core/messages";
import { load, openServices, type GlobalOptions, type Services } from "../bootstrap.js";
import { createDeliver } from "../channels.js";
import { setupKnowledge, type KnowledgeSetup } from "../knowledge.js";
import { note, warn } from "../ui/output.js";

export const CLI_CHANNEL = "cli";

export interface SessionOption extends GlobalOptions {
  session?: string;
}

export function logger() {
  return createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) });
}

export async function resolveSession(runtime: AgentRuntime, services: Services, sessionId?: string): Promise<{ session: Session; created: boolean }> {
  return new SessionManager(runtime.sessions).resolve({
    channel: CLI_CHANNEL,
    agentId: services.loaded.config.agent.name,
    ...(sessionId !== undefined && { sessionId }),
  });
}

export function firstLine(text: string | undefined): string {
  return (text ?? "").split("\n")[0] ?? "";
}

/** Warns (stderr) about MCP servers that failed to connect. */
export function reportMcpFailures(mcp: McpManager): void {
  for (const s of mcp.status()) if (s.state === "failed") warn(`MCP server ${s.name} unavailable: ${firstLine(s.error)}`);
}

export function memoryNotice(services: Services): void {
  if (!services.persistent) note("storage.provider is memory — sessions and runs are not kept between CLI invocations.");
}

/** Ingests knowledge.sources before a run/serve and reports on stderr. */
export async function prepareKnowledge(knowledge: KnowledgeSetup, verbose: boolean): Promise<void> {
  if (knowledge.kb === undefined) return;
  const { ingested, skipped, errors } = await knowledge.ingestSources();
  // The in-memory store re-ingests on every start, so only report it when asked to be verbose.
  if (verbose || (ingested > 0 && knowledge.vectorStore !== "memory")) note(`knowledge (${knowledge.vectorStore}): ${ingested} documents ingested, ${skipped} unchanged`);
  for (const e of errors) warn(`could not ingest ${e.path}: ${e.error}`);
}

export function openKnowledge(options: GlobalOptions): { knowledge: KnowledgeSetup; loaded: LoadedConfig } {
  const loaded = load(options);
  return { knowledge: setupKnowledge(loaded, new InMemorySessionStore(), logger()), loaded };
}

export function requireKb(knowledge: KnowledgeSetup): KnowledgeBase {
  if (knowledge.kb === undefined) throw new BanglaClawError("KNOWLEDGE_DISABLED", "knowledge.enabled is false in banglaclaw.yaml");
  return knowledge.kb;
}

export function requireMemory(knowledge: KnowledgeSetup): LongTermMemory {
  if (knowledge.memory === undefined) throw new BanglaClawError("MEMORY_DISABLED", "memory.longTerm.enabled is false in banglaclaw.yaml");
  if (knowledge.vectorStore === "memory") throw new BanglaClawError("PERSISTENT_STORE_REQUIRED", "Long-term memories only persist with knowledge.vectorStore: qdrant");
  return knowledge.memory;
}

export async function withServices<T>(options: GlobalOptions, fn: (services: Services) => Promise<T>): Promise<T> {
  const services = await openServices(options);
  try {
    return await fn(services);
  } finally {
    await services.close();
  }
}

export async function withPersistent<T>(options: GlobalOptions, what: string, fn: (services: Services) => Promise<T>): Promise<T> {
  return withServices(options, async (services) => {
    if (!services.persistent) throw new BanglaClawError("STORAGE_REQUIRED", `${what} need${what.endsWith("s") ? "" : "s"} postgres storage`);
    return fn(services);
  });
}

export async function withAuth<T>(options: GlobalOptions, fn: (auth: ApiKeyAuthenticator, services: Services) => Promise<T>): Promise<T> {
  return withPersistent(options, "API keys", (services) => fn(new ApiKeyAuthenticator(services.auth), services));
}

export async function withDesk<T>(options: GlobalOptions, fn: (desk: HandoffDesk, services: Services) => Promise<T>): Promise<T> {
  return withPersistent(options, "Handoff queues", (services) => {
    const log = logger();
    return fn(new HandoffDesk(services.sessions, services.runs, createDeliver(services.loaded, log), auditRecorder(services.audit, log)), services);
  });
}

export interface MessageView {
  role: "user" | "assistant" | "operator" | "tool" | "system";
  content: string;
  toolCalls?: { name: string; args: unknown }[];
}

export function messageView(m: BaseMessage): MessageView {
  const type = m.getType();
  const calls = "tool_calls" in m && Array.isArray(m.tool_calls) ? (m.tool_calls as { name: string; args: unknown }[]) : [];
  const role = type === "human" ? "user" : isOperatorMessage(m) ? "operator" : type === "ai" ? "assistant" : type === "tool" ? "tool" : "system";
  return { role, content: m.text, ...(calls.length > 0 && { toolCalls: calls.map((c) => ({ name: c.name, args: c.args })) }) };
}

export function limit(value: string, name = "--limit"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BanglaClawError("INVALID_ARGUMENT", `${name} must be a positive integer`);
  return n;
}
