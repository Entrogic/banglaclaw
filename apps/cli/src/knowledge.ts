import type { ContextProvider } from "@banglaclaw/agent";
import {
  InMemoryVectorStore, KnowledgeBase, LongTermMemory, OpenAICompatibleEmbedder, QdrantVectorStore,
  createKnowledgeTools, createMemoryTools, memoryContextProvider, type VectorStore,
} from "@banglaclaw/knowledge";
import type { SessionStore } from "@banglaclaw/session";
import type { LoadedConfig, Logger } from "@banglaclaw/shared";
import type { AnyTool } from "@banglaclaw/tools";

export interface KnowledgeSetup {
  kb?: KnowledgeBase;
  memory?: LongTermMemory;
  tools: AnyTool[];
  contextProviders: ContextProvider[];
  /** "memory" or "qdrant" when anything is enabled. */
  vectorStore?: string;
  /** Ingests `knowledge.sources` (unchanged files are skipped). */
  ingestSources(): Promise<{ ingested: number; skipped: number; errors: { path: string; error: string }[] }>;
}

/** Builds the knowledge base and long-term memory from config (docs/07). Nothing is created when both are disabled. */
export function setupKnowledge(loaded: LoadedConfig, sessions: SessionStore, logger: Logger): KnowledgeSetup {
  const { config, secrets } = loaded;
  const k = config.knowledge;
  const lt = config.memory.longTerm;
  const empty: KnowledgeSetup = { tools: [], contextProviders: [], ingestSources: async () => ({ ingested: 0, skipped: 0, errors: [] }) };
  if (!k.enabled && !lt.enabled) return empty;

  const apiKey = secrets.embeddingsApiKey ?? secrets.openaiApiKey;
  const embedder = new OpenAICompatibleEmbedder({
    model: config.embeddings.model,
    ...(apiKey !== undefined && { apiKey }),
    ...(config.embeddings.baseUrl !== undefined && { baseUrl: config.embeddings.baseUrl }),
    ...(config.embeddings.dimensions !== undefined && { dimensions: config.embeddings.dimensions }),
  });
  const store: VectorStore =
    k.vectorStore === "qdrant"
      ? new QdrantVectorStore({ url: k.vectorStoreUrl, ...(secrets.qdrantApiKey !== undefined && { apiKey: secrets.qdrantApiKey }) })
      : new InMemoryVectorStore();

  const setup: KnowledgeSetup = { ...empty, tools: [], contextProviders: [], vectorStore: store.kind };
  if (k.enabled) {
    const kb = new KnowledgeBase({ store, embedder, collection: k.collection, chunkSize: k.chunkSize, chunkOverlap: k.chunkOverlap, logger });
    setup.kb = kb;
    setup.tools.push(...createKnowledgeTools(kb, { limit: k.searchLimit, minScore: k.minScore }));
    setup.ingestSources = async () => {
      if (k.sources.length === 0) return { ingested: 0, skipped: 0, errors: [] };
      const { results, errors } = await kb.ingestPaths(k.sources, loaded.baseDir);
      return { ingested: results.filter((r) => !r.skipped).length, skipped: results.filter((r) => r.skipped).length, errors };
    };
  }
  if (lt.enabled) {
    const memory = new LongTermMemory({ store, embedder, collection: lt.collection, maxPerOwner: lt.maxPerOwner });
    setup.memory = memory;
    setup.tools.push(...createMemoryTools(memory, sessions, { recallLimit: lt.recallLimit }));
    if (lt.autoRecall) setup.contextProviders.push(memoryContextProvider(memory, { limit: lt.recallLimit }));
  }
  return setup;
}
