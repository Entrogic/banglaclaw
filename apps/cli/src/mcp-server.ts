import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgentRunError, type AgentRuntime } from "@entrogic-net/agent";
import type { KnowledgeBase } from "@entrogic-net/knowledge";
import { SessionManager, type RunRecord } from "@entrogic-net/session";

/** Session channel for conversations that arrive through `banglaclaw mcp serve`. */
export const MCP_CHANNEL = "mcp";

export interface McpServerOptions {
  runtime: AgentRuntime;
  agentName: string;
  version: string;
  maxInputChars: number;
  knowledge?: { kb: KnowledgeBase; searchLimit: number; minScore: number };
}

/**
 * BanglaClaw as an MCP server (docs/10): other agents (Claude Desktop, Cursor, Claude Code…) can
 * ask the BanglaClaw agent questions, with its skills, tools, knowledge and permission policy, and
 * search its knowledge base. Each `conversation` name keeps its own session and history.
 */
export function createBanglaClawMcpServer(options: McpServerOptions): McpServer {
  const { runtime } = options;
  const sessions = new SessionManager(runtime.sessions);
  const server = new McpServer(
    { name: "banglaclaw", version: options.version },
    {
      instructions:
        "BanglaClaw is a Bangla-first assistant. Use `ask` for questions in Bangla, Banglish or English, especially about Bangladesh, Bangla text, taka amounts and the operator's own knowledge base; it replies in the language of the message.",
    },
  );

  server.registerTool(
    "ask",
    {
      title: "Ask BanglaClaw",
      description:
        "Send a message to the BanglaClaw agent and get its reply. It understands Bangla, Banglish and English and uses its configured skills, tools and knowledge base. Messages with the same `conversation` share history; set `new_conversation` to start over.",
      inputSchema: {
        message: z.string().trim().min(1).max(options.maxInputChars).describe("The message, e.g. ১৫০০ টাকার ১৫% ভ্যাট কত?"),
        conversation: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[\w.:-]+$/, "letters, digits, _ . : - only")
          .default("default")
          .describe("Conversation name; the same name continues the same conversation"),
        new_conversation: z.boolean().default(false).describe("Forget this conversation's history first"),
      },
      outputSchema: {
        reply: z.string(),
        conversation: z.string(),
        sessionId: z.string(),
        status: z.enum(["completed", "limited", "error", "aborted", "handoff"]),
        language: z.enum(["bn", "bn-en", "en"]),
        skills: z.array(z.string()),
        tools: z.array(z.string()),
      },
      annotations: { title: "Ask BanglaClaw", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ message, conversation, new_conversation }, extra) => {
      if (new_conversation) {
        const existing = await runtime.sessions.findByExternalId(MCP_CHANNEL, conversation);
        if (existing !== undefined) await runtime.sessions.detachExternalId(existing.id);
      }
      const { session } = await sessions.resolve({ channel: MCP_CHANNEL, externalId: conversation, agentId: options.agentName });
      let record: RunRecord;
      try {
        record = await runtime.run(message, { sessionId: session.id, signal: extra.signal });
      } catch (error) {
        if (!(error instanceof AgentRunError)) throw error;
        record = error.record;
      }
      const reply = replyText(record);
      const structured = {
        reply,
        conversation,
        sessionId: session.id,
        status: record.status,
        language: record.language,
        skills: record.skills,
        tools: record.toolCalls.map((t) => t.tool),
      };
      return { content: [{ type: "text" as const, text: reply }], structuredContent: structured, ...(record.status === "error" && { isError: true }) };
    },
  );

  const knowledge = options.knowledge;
  if (knowledge !== undefined) {
    server.registerTool(
      "search_knowledge",
      {
        title: "Search BanglaClaw knowledge",
        description: "Search the documents ingested into BanglaClaw's knowledge base (policies, FAQs, manuals). Returns matching passages with their source.",
        inputSchema: {
          query: z.string().trim().min(1).max(500).describe("What to look for, in Bangla or English"),
          limit: z.number().int().min(1).max(20).default(knowledge.searchLimit),
        },
        annotations: { title: "Search knowledge", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ query, limit }) => {
        const results = await knowledge.kb.search(query, { limit, minScore: knowledge.minScore });
        const text =
          results.length === 0
            ? "No matching passages."
            : results.map((r, i) => `[${i + 1}] ${r.title} (${r.source}, score ${r.score.toFixed(2)})\n${r.text}`).join("\n\n");
        return { content: [{ type: "text" as const, text }], structuredContent: { results } };
      },
    );
  }

  return server;
}

function replyText(record: RunRecord): string {
  if (record.output !== undefined && record.output !== "") return record.output;
  if (record.status === "handoff") return "A human operator is handling this conversation now; they will reply through BanglaClaw's operator desk.";
  if (record.status === "aborted") return "The request was cancelled.";
  if (record.status === "error") return `BanglaClaw could not answer: ${record.error ?? "unknown error"}`;
  if (record.status === "limited") return "BanglaClaw stopped before finishing (step limit reached).";
  return "";
}
