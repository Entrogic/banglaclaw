/**
 * Gateway with seeded in-memory data for working on the dashboard without a model key or database.
 *   pnpm --filter @entrogic-net/dashboard demo        # API on :3000, prints an admin key
 *   pnpm --filter @entrogic-net/dashboard dev         # Vite on :5173/admin/, proxies /v1 to it
 * After `pnpm --filter @entrogic-net/dashboard build`, the built page is also served at :3000/admin/.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AgentRuntime } from "@entrogic-net/agent";
import { ApiKeyAuthenticator, InMemoryAuthStore } from "@entrogic-net/auth";
import { startGateway } from "@entrogic-net/gateway";
import { HashEmbedder, InMemoryVectorStore, KnowledgeBase } from "@entrogic-net/knowledge";
import { FakeProvider } from "@entrogic-net/providers";
import { InMemoryRunStore, InMemorySessionStore, type RunRecord } from "@entrogic-net/session";
import { InMemoryAuditStore, createLogger } from "@entrogic-net/shared";
import { SkillSet, loadSkillsFromDirs } from "@entrogic-net/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@entrogic-net/tools";

const DAY = 86_400_000;
const logger = createLogger({ write: () => {} });
const sessions = new InMemorySessionStore();
const runs = new InMemoryRunStore(sessions);
const registry = new ToolRegistry();
for (const tool of builtinTools) registry.register(tool);
const policy = new AllowlistPolicy(["calculator", "current_datetime"]);

// Real runs through the runtime give the sessions genuine transcripts.
const conversations: { channel: string; externalId: string; turns: [string, string][] }[] = [
  { channel: "telegram", externalId: "501234567", turns: [["আমার অর্ডার কবে আসবে?", "আপনার অর্ডার আগামীকাল ঢাকায় পৌঁছাবে।"], ["ধন্যবাদ!", "আপনাকেও ধন্যবাদ 🙏"]] },
  { channel: "whatsapp", externalId: "8801712345678", turns: [["bkash e payment kivabe korbo?", "bKash অ্যাপে Payment অপশনে গিয়ে মার্চেন্ট নম্বর দিন।"]] },
  { channel: "api", externalId: "web-3f2a", turns: [["What is 15% VAT on 2400 taka?", "15% VAT on ৳2,400 is ৳360, so the total is ৳2,760."]] },
  { channel: "web", externalId: "visitor-81", turns: [["হ্যালো", "হ্যালো! কীভাবে সাহায্য করতে পারি?"]] },
];
const script = conversations.flatMap((c) => c.turns.map(([, reply]) => ({ content: reply, usage: { input: 900, output: 60 } })));
const provider = new FakeProvider(script);
const runtime = new AgentRuntime({ provider, registry, policy, sessions, runs, limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger });

const ids: string[] = [];
for (const c of conversations) {
  const session = await sessions.create({ channel: c.channel, externalId: c.externalId, agentId: "banglaclaw" });
  ids.push(session.id);
  for (const [text] of c.turns) await runtime.run(text, { sessionId: session.id });
}
await sessions.update(ids[1] ?? "", { status: "handoff", handoffReason: "Customer asked for a refund" });

// Synthetic history for the charts: a weekly rhythm, some errors, limits and tool calls.
let seed = 7;
const rand = () => ((seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647);
const providers = ["openai-compatible:gpt-4o-mini", "anthropic:claude-sonnet-5"];
for (let day = 29; day >= 0; day--) {
  const count = Math.round(18 + 10 * Math.sin(day / 2) + rand() * 12);
  for (let i = 0; i < count; i++) {
    const startedAt = new Date(Date.now() - day * DAY - rand() * DAY * 0.9);
    const roll = rand();
    const status: RunRecord["status"] = roll < 0.05 ? "error" : roll < 0.08 ? "limited" : roll < 0.11 ? "handoff" : "completed";
    const tools = rand() < 0.4 ? [rand() < 0.7 ? "calculator" : "bangladesh__district_info"] : [];
    const durationMs = Math.round(800 + rand() * 4000);
    await runs.save({
      id: crypto.randomUUID(),
      sessionId: ids[Math.floor(rand() * ids.length)] ?? "",
      provider: providers[rand() < 0.7 ? 0 : 1] ?? "",
      promptVersion: "demo",
      language: rand() < 0.6 ? "bn" : rand() < 0.5 ? "bn-en" : "en",
      skills: [],
      agent: rand() < 0.8 ? "supervisor" : "billing",
      agentPath: ["supervisor"],
      usage: { inputTokens: Math.round(600 + rand() * 1800), outputTokens: Math.round(40 + rand() * 300) },
      input: "…",
      status,
      ...(status === "error" && { error: "Provider timed out" }),
      iterations: 1 + tools.length,
      toolCalls: tools.map((tool) => ({ runId: "", toolCallId: crypto.randomUUID(), tool, input: {}, status: rand() < 0.1 ? "error" : "ok", durationMs: Math.round(rand() * 300) })),
      startedAt,
      finishedAt: new Date(startedAt.getTime() + durationMs),
      durationMs,
    });
  }
}

// Knowledge base with offline hash embeddings, and a few audit events.
const kb = new KnowledgeBase({ store: new InMemoryVectorStore(), embedder: new HashEmbedder(), collection: "demo", chunkSize: 600, chunkOverlap: 60 });
await kb.ingestText({ source: "policies/returns.md", title: "ফেরত ও রিফান্ড নীতি", text: "পণ্য হাতে পাওয়ার ৭ দিনের মধ্যে ফেরত দেওয়া যায়। ত্রুটিপূর্ণ বা ভুল পণ্যের ক্ষেত্রে ডেলিভারি চার্জ আমরা বহন করি। রিফান্ড ৫-৭ কর্মদিবসে bKash বা ব্যাংকে পাঠানো হয়।" });
await kb.ingestText({ source: "policies/delivery.md", title: "Delivery", text: "Delivery inside Dhaka takes 1-2 days and costs ৳60. Outside Dhaka it takes 3-5 days and costs ৳120. Cash on delivery is available everywhere." });
const audit = new InMemoryAuditStore();
await audit.record({ action: "auth.failed", outcome: "failure", ip: "203.0.113.7", target: "GET /v1/sessions", at: new Date(Date.now() - 3 * 3_600_000) });
await audit.record({ action: "tool.denied", outcome: "denied", actorId: "system", target: "shell_exec", metadata: { reason: "not in tools.allow" }, at: new Date(Date.now() - 2 * 3_600_000) });
await audit.record({ action: "handoff.requested", outcome: "success", actorId: "system", target: ids[1] ?? "", metadata: { reason: "Customer asked for a refund" }, at: new Date(Date.now() - 3_600_000) });

const auth = new ApiKeyAuthenticator(new InMemoryAuthStore());
const admin = await auth.issueKey("demo-admin", "laptop", "admin");
await auth.issueKey("shop-bot", "production", "user");
await auth.issueKey("support-desk", "default", "operator");
const dist = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT ?? 3000);

const gateway = await startGateway({
  runtime, sessions, runs, auth, registry, policy, skills: new SkillSet(loadSkillsFromDirs(["skills"], fileURLToPath(new URL("../../..", import.meta.url)))), agent: { name: "banglaclaw", model: provider.id },
  config: { host: "127.0.0.1", port, corsOrigins: [], maxInputChars: 8000, trustProxy: false, metrics: false, rateLimit: { requestsPerMinute: 600, maxConcurrentRuns: 2 } },
  version: "demo", logger, timezone: "Asia/Dhaka", audit,
  knowledge: { kb, searchLimit: 5, minScore: 0 },
  pricing: { "openai-compatible:gpt-4o-mini": { input: 0.15, output: 0.6 }, "anthropic:claude-sonnet-5": { input: 3, output: 15 } },
  ...(existsSync(`${dist}/index.html`) && { dashboardDir: dist }),
});

process.stdout.write(`Demo gateway on ${gateway.url}\nAdmin key: ${admin.token}\n`);
