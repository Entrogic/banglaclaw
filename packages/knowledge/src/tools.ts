import { z } from "zod";
import type { ContextProvider } from "@banglaclaw/agent";
import type { SessionStore } from "@banglaclaw/session";
import { ToolExecutionError } from "@banglaclaw/shared";
import { defineTool, type AnyTool, type ToolContext } from "@banglaclaw/tools";
import type { KnowledgeBase } from "./knowledge-base.js";
import { memoryOwner, type LongTermMemory } from "./memory.js";

const MAX_HIT_CHARS = 1_500;

/** `search_knowledge`: retrieval over ingested documents, returning citable sources. */
export function createKnowledgeTools(kb: KnowledgeBase, options: { limit: number; minScore: number }): AnyTool[] {
  return [
    defineTool({
      name: "search_knowledge",
      description:
        "Search the organisation's knowledge base (ingested documents) for passages relevant to a question. Use it for questions about products, policies, prices or documents; cite sources as [source#chunk]. Works with Bangla, Banglish and English queries.",
      risk: "safe",
      timeoutMs: 20_000,
      inputSchema: z.strictObject({
        query: z.string().min(1).max(500).describe("What to look for, in the user's words"),
        limit: z.int().min(1).max(10).optional(),
      }),
      outputSchema: z.strictObject({
        results: z.array(z.strictObject({ citation: z.string(), title: z.string(), score: z.number(), text: z.string() })),
      }),
      async execute({ query, limit }) {
        const hits = await kb.search(query, { limit: limit ?? options.limit, minScore: options.minScore });
        return {
          results: hits.map((h) => ({
            citation: `${h.source}#${h.chunkIndex}`,
            title: h.title,
            score: h.score,
            text: h.text.length > MAX_HIT_CHARS ? `${h.text.slice(0, MAX_HIT_CHARS)}…` : h.text,
          })),
        };
      },
    }),
  ];
}

async function ownerFor(sessions: SessionStore, ctx: ToolContext): Promise<string> {
  const session = await sessions.get(ctx.sessionId);
  if (session === undefined) throw new ToolExecutionError("Session not found");
  return memoryOwner(session);
}

/**
 * `remember` / `recall` / `forget`, always scoped to the current session's owner — the model
 * cannot read or write another user's memories because the owner is derived server-side.
 */
export function createMemoryTools(memory: LongTermMemory, sessions: SessionStore, options: { recallLimit: number }): AnyTool[] {
  const MemorySchema = z.strictObject({ id: z.string(), text: z.string(), createdAt: z.string(), score: z.number().optional() });
  return [
    defineTool({
      name: "remember",
      description:
        "Save a durable fact about the user for future conversations (name, preferences, important details). Only when the user asks you to remember something or clearly states a lasting personal fact. One short fact per call, written in the user's language. Never store passwords, OTPs or payment details.",
      risk: "sensitive",
      inputSchema: z.strictObject({ fact: z.string().min(3).max(500) }),
      outputSchema: z.strictObject({ id: z.string(), stored: z.boolean(), duplicate: z.boolean() }),
      async execute({ fact }, ctx) {
        if (/\b(password|passcode|otp|pin|cvv)\b|পাসওয়ার্ড|ওটিপি/i.test(fact)) {
          throw new ToolExecutionError("Refusing to store secrets such as passwords, OTPs or PINs");
        }
        const { memory: m, duplicate } = await memory.remember(await ownerFor(sessions, ctx), fact, ctx.sessionId);
        return { id: m.id, stored: !duplicate, duplicate };
      },
    }),
    defineTool({
      name: "recall",
      description:
        "Search what you have remembered about the current user. Use it when the user asks what you know or remember about them (name, preferences, earlier details), before saying you don't know.",
      risk: "safe",
      inputSchema: z.strictObject({ query: z.string().min(1).max(300) }),
      outputSchema: z.strictObject({ memories: z.array(MemorySchema) }),
      async execute({ query }, ctx) {
        const found = await memory.recall(await ownerFor(sessions, ctx), query, options.recallLimit);
        return { memories: found.map(({ id, text, createdAt, score }) => ({ id, text, createdAt, ...(score !== undefined && { score }) })) };
      },
    }),
    defineTool({
      name: "forget",
      description: "Delete one remembered fact about the current user by its id (from recall), when the user asks you to forget it.",
      // The user's own data at their request, owner-checked server-side; not an irreversible business operation.
      risk: "sensitive",
      inputSchema: z.strictObject({ memory_id: z.string().min(1).max(100) }),
      outputSchema: z.strictObject({ forgotten: z.boolean() }),
      async execute({ memory_id }, ctx) {
        return { forgotten: await memory.forget(await ownerFor(sessions, ctx), memory_id) };
      },
    }),
  ];
}

/**
 * Adds the owner's memories to the system prompt before each run. When the owner has no more
 * than `limit` memories, all are included — cross-lingual similarity (Banglish question vs English
 * fact) is often low, and a few short facts are cheap. Otherwise the top `limit` by similarity.
 */
export function memoryContextProvider(memory: LongTermMemory, options: { limit: number; minScore?: number }): ContextProvider {
  return async ({ session, input }) => {
    const owner = memoryOwner(session);
    const found =
      (await memory.count(owner)) <= options.limit
        ? await memory.list(owner, options.limit)
        : await memory.recall(owner, input, options.limit, options.minScore ?? 0.1);
    if (found.length === 0) return undefined;
    return `Things you remember about this user (from earlier conversations):\n${found.map((m) => `- ${m.text}`).join("\n")}`;
  };
}
