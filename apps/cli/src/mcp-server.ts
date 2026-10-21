import type { BaseMessage } from "@langchain/core/messages";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgentRunError, type AgentRuntime } from "@entrogic-net/agent";
import type { KnowledgeBase } from "@entrogic-net/knowledge";
import { SessionManager, isOperatorMessage, type RunRecord, type Session } from "@entrogic-net/session";
import type { SkillSet } from "@entrogic-net/skills";

/** Session channel for conversations that arrive through `banglaclaw mcp serve`. */
export const MCP_CHANNEL = "mcp";

export interface McpServerOptions {
  runtime: AgentRuntime;
  agentName: string;
  version: string;
  maxInputChars: number;
  knowledge?: { kb: KnowledgeBase; searchLimit: number; minScore: number };
  /** Skills become MCP prompts and `banglaclaw://skills/{name}` resources. */
  skills?: SkillSet;
  /** Tools the agent may call (after `tools.allow`), listed in `banglaclaw://agent`. */
  allowedTools?: string[];
  /** The provider id new runs use, e.g. "anthropic:claude-sonnet-5". */
  model?: () => string;
}

/** Messages shown per conversation resource. */
const TRANSCRIPT_LIMIT = 200;

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

  registerResources(server, options);
  registerSkillPrompts(server, options.skills);
  return server;
}

/**
 * Read-only context for MCP clients (docs/10): the agent's setup, its skills, knowledge documents
 * and the transcripts of MCP conversations. Sessions from other channels (Telegram, WhatsApp, the
 * API…) are never exposed here.
 */
function registerResources(server: McpServer, options: McpServerOptions): void {
  const { runtime, skills, knowledge } = options;
  const json = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] });
  const text = (uri: URL, mimeType: string, body: string) => ({ contents: [{ uri: uri.href, mimeType, text: body }] });
  const notFound = (what: string) => {
    throw new Error(`${what} not found`);
  };

  server.registerResource(
    "agent",
    "banglaclaw://agent",
    { title: "BanglaClaw agent", description: "The agent's name, model, allowed tools and skills", mimeType: "application/json" },
    (uri) =>
      json(uri, {
        name: options.agentName,
        version: options.version,
        ...(options.model !== undefined && { model: options.model() }),
        tools: options.allowedTools ?? [],
        skills: (skills?.list() ?? []).map((s) => ({ name: s.name, description: s.description, triggers: s.triggers })),
        knowledge: knowledge !== undefined,
      }),
  );

  if (skills !== undefined && skills.list().length > 0) {
    server.registerResource(
      "skill",
      new ResourceTemplate("banglaclaw://skills/{name}", {
        list: () => ({ resources: skills.list().map((s) => ({ uri: `banglaclaw://skills/${encodeURIComponent(s.name)}`, name: s.name, description: s.description, mimeType: "text/markdown" })) }),
        complete: { name: (value) => skills.list().map((s) => s.name).filter((n) => n.startsWith(value)) },
      }),
      { title: "BanglaClaw skill", description: "A skill's instructions (SKILL.md), as the agent receives them", mimeType: "text/markdown" },
      (uri, { name }) => {
        const skill = skills.get(decodeURIComponent(String(name)));
        if (skill === undefined) return notFound("Skill");
        const header = [`# ${skill.name}`, "", skill.description, "", `Triggers: ${skill.triggers.join(", ") || "(none)"}`, ...(skill.tools.length > 0 ? [`Tools: ${skill.tools.join(", ")}`] : [])].join("\n");
        return text(uri, "text/markdown", `${header}\n\n${skill.instructions.trim()}\n`);
      },
    );
  }

  if (knowledge !== undefined) {
    server.registerResource(
      "knowledge-document",
      new ResourceTemplate("banglaclaw://knowledge/{documentId}", {
        list: async () => ({
          resources: (await knowledge.kb.listDocuments()).map((d) => ({ uri: `banglaclaw://knowledge/${encodeURIComponent(d.documentId)}`, name: d.title || d.source, description: `${d.source} · ${d.chunkCount} chunk(s)`, mimeType: "text/plain" })),
        }),
      }),
      { title: "Knowledge document", description: "A document from BanglaClaw's knowledge base, as ingested", mimeType: "text/plain" },
      async (uri, { documentId }) => {
        const doc = await knowledge.kb.getDocument(decodeURIComponent(String(documentId)));
        if (doc === undefined) return notFound("Document");
        return text(uri, "text/plain", doc.text);
      },
    );
  }

  const conversations = async (): Promise<Session[]> => (await runtime.sessions.list({ channel: MCP_CHANNEL, limit: 200 })).filter((s) => s.externalId !== undefined);
  server.registerResource(
    "conversation",
    new ResourceTemplate("banglaclaw://conversations/{conversation}", {
      list: async () => ({
        resources: (await conversations()).map((s) => ({ uri: `banglaclaw://conversations/${encodeURIComponent(s.externalId ?? "")}`, name: s.externalId ?? s.id, ...(s.title !== undefined && { description: s.title }), mimeType: "text/markdown" })),
      }),
      complete: { conversation: async (value) => (await conversations()).map((s) => s.externalId ?? "").filter((c) => c.startsWith(value)) },
    }),
    { title: "MCP conversation", description: "The transcript of an `ask` conversation (channel mcp only)", mimeType: "text/markdown" },
    async (uri, { conversation }) => {
      const name = decodeURIComponent(String(conversation));
      const session = await runtime.sessions.findByExternalId(MCP_CHANNEL, name);
      if (session === undefined) return notFound("Conversation");
      return text(uri, "text/markdown", transcript(name, await runtime.sessions.recentMessages(session.id, TRANSCRIPT_LIMIT)));
    },
  );
}

/** Each skill as an MCP prompt: its instructions plus the user's request, for the client's own model. */
function registerSkillPrompts(server: McpServer, skills: SkillSet | undefined): void {
  for (const skill of skills?.list() ?? []) {
    server.registerPrompt(
      skill.name,
      {
        title: skill.name,
        description: `BanglaClaw skill: ${skill.description}`,
        argsSchema: { request: z.string().max(20_000).optional().describe("What you want done, in Bangla, Banglish or English") },
      },
      ({ request }) => ({
        description: skill.description,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Follow these instructions from the BanglaClaw "${skill.name}" skill (${skill.description}). Reply in the language of the request (Bangla, Banglish or English).\n\n${skill.instructions.trim()}${request !== undefined && request.trim() !== "" ? `\n\n---\n\n${request.trim()}` : ""}`,
            },
          },
        ],
      }),
    );
  }
}

/** User and assistant turns only: tool traffic and system messages stay internal. */
function transcript(name: string, messages: BaseMessage[]): string {
  const lines = [`# Conversation ${name}`, ""];
  for (const m of messages) {
    const type = m.getType();
    const text = m.text.trim();
    if (text === "" || (type !== "human" && type !== "ai")) continue;
    lines.push(`**${type === "human" ? "User" : isOperatorMessage(m) ? "Operator" : "BanglaClaw"}:** ${text}`, "");
  }
  return lines.join("\n");
}

function replyText(record: RunRecord): string {
  if (record.output !== undefined && record.output !== "") return record.output;
  if (record.status === "handoff") return "A human operator is handling this conversation now; they will reply through BanglaClaw's operator desk.";
  if (record.status === "aborted") return "The request was cancelled.";
  if (record.status === "error") return `BanglaClaw could not answer: ${record.error ?? "unknown error"}`;
  if (record.status === "limited") return "BanglaClaw stopped before finishing (step limit reached).";
  return "";
}
