import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AgentRuntime } from "@entrogic-net/agent";
import { HashEmbedder, InMemoryVectorStore, KnowledgeBase } from "@entrogic-net/knowledge";
import { FakeProvider, type ModelProvider, type ScriptedTurn } from "@entrogic-net/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@entrogic-net/session";
import { createLogger } from "@entrogic-net/shared";
import { SkillSet, parseSkill } from "@entrogic-net/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@entrogic-net/tools";
import { MCP_CHANNEL, createBanglaClawMcpServer } from "../src/mcp-server.js";

/** A model provider that is down. */
const failing: ModelProvider = {
  id: "failing",
  chat: () => Promise.reject(new Error("provider down")),
  stream: async function* () {
    throw new Error("provider down");
  },
};

async function connect(script: ScriptedTurn[] | ModelProvider, withKnowledge = false) {
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore(sessions);
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  const provider = Array.isArray(script) ? new FakeProvider(script) : script;
  const runtime = new AgentRuntime({
    provider, registry, policy: new AllowlistPolicy(["calculator"]), sessions, runs,
    limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: createLogger({ write: () => {} }),
  });
  let knowledge;
  if (withKnowledge) {
    const kb = new KnowledgeBase({ store: new InMemoryVectorStore(), embedder: new HashEmbedder(), collection: "t", chunkSize: 500, chunkOverlap: 50 });
    await kb.ingestText({ source: "returns.md", title: "Returns", text: "পণ্য হাতে পাওয়ার ৭ দিনের মধ্যে ফেরত দেওয়া যায়।" });
    knowledge = { kb, searchLimit: 3, minScore: 0 };
  }
  const skills = new SkillSet([parseSkill("---\nname: vat\ndescription: VAT on taka amounts\ntools: [calculator]\ntriggers: [ভ্যাট, vat]\n---\nAlways show the VAT rate and the total in taka (৳).\n")]);
  const server = createBanglaClawMcpServer({
    runtime, agentName: "banglaclaw", version: "test", maxInputChars: 200, skills, allowedTools: ["calculator"], model: () => provider.id,
    ...(knowledge !== undefined && { knowledge }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, sessions, provider: provider instanceof FakeProvider ? provider : undefined };
}

const textOf = (result: { contents: ({ text: string } | { blob: string })[] }) => {
  const first = result.contents[0];
  return first !== undefined && "text" in first ? first.text : "";
};

describe("BanglaClaw MCP server resources and prompts", () => {
  it("describes the agent and serves skills as resources and prompts", async () => {
    const { client } = await connect([{ content: "unused" }]);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["banglaclaw://agent", "banglaclaw://skills/vat"]);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual(["banglaclaw://skills/{name}", "banglaclaw://conversations/{conversation}"]);

    const agent = JSON.parse(textOf(await client.readResource({ uri: "banglaclaw://agent" }))) as Record<string, unknown>;
    expect(agent).toMatchObject({ name: "banglaclaw", model: "fake:scripted", tools: ["calculator"], skills: [{ name: "vat", triggers: ["ভ্যাট", "vat"] }], knowledge: false });

    const skill = textOf(await client.readResource({ uri: "banglaclaw://skills/vat" }));
    expect(skill).toContain("# vat");
    expect(skill).toContain("Always show the VAT rate");
    await expect(client.readResource({ uri: "banglaclaw://skills/missing" })).rejects.toThrow(/not found/);

    const { prompts } = await client.listPrompts();
    expect(prompts).toEqual([expect.objectContaining({ name: "vat", description: "BanglaClaw skill: VAT on taka amounts" })]);
    const prompt = await client.getPrompt({ name: "vat", arguments: { request: "১৫০০ টাকার ভ্যাট কত?" } });
    const message = prompt.messages[0]?.content;
    expect(message?.type === "text" && message.text).toMatch(/Always show the VAT rate[\s\S]*---\n\n১৫০০ টাকার ভ্যাট কত\?$/);
  });

  it("serves knowledge documents and MCP conversation transcripts, but no other channel", async () => {
    const { client, sessions } = await connect([{ content: "ফেরত ৭ দিনের মধ্যে।" }], true);
    await client.callTool({ name: "ask", arguments: { message: "ফেরত নীতি?", conversation: "shop-1" } });
    await sessions.create({ channel: "telegram", agentId: "banglaclaw", externalId: "12345" });

    const { resources } = await client.listResources();
    const docUri = resources.find((r) => r.uri.startsWith("banglaclaw://knowledge/"))?.uri ?? "";
    expect(resources.find((r) => r.uri === docUri)).toMatchObject({ name: "Returns" });
    expect(textOf(await client.readResource({ uri: docUri }))).toBe("পণ্য হাতে পাওয়ার ৭ দিনের মধ্যে ফেরত দেওয়া যায়।");

    expect(resources.filter((r) => r.uri.startsWith("banglaclaw://conversations/")).map((r) => r.uri)).toEqual(["banglaclaw://conversations/shop-1"]);
    const transcript = textOf(await client.readResource({ uri: "banglaclaw://conversations/shop-1" }));
    expect(transcript).toBe("# Conversation shop-1\n\n**User:** ফেরত নীতি?\n\n**BanglaClaw:** ফেরত ৭ দিনের মধ্যে।\n");
    await expect(client.readResource({ uri: "banglaclaw://conversations/12345" })).rejects.toThrow(/not found/);
  });
});

describe("BanglaClaw MCP server", () => {
  it("answers with the agent, runs its tools and keeps history per conversation", async () => {
    const { client, sessions, provider } = await connect([
      { toolCalls: [{ name: "calculator", args: { expression: "1500*15/100" } }] },
      { content: "১৫০০ টাকার ১৫% হলো ২২৫ টাকা।" },
      { content: "মোট ১৭২৫ টাকা।" },
      { content: "Hello again" },
    ]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["ask"]);

    const first = await client.callTool({ name: "ask", arguments: { message: "১৫০০ টাকার ১৫% ভ্যাট কত?", conversation: "shop" } });
    expect(first.content).toEqual([{ type: "text", text: "১৫০০ টাকার ১৫% হলো ২২৫ টাকা।" }]);
    expect(first.structuredContent).toMatchObject({ conversation: "shop", status: "completed", language: "bn", tools: ["calculator"] });

    // Same conversation: the model sees the earlier turns.
    await client.callTool({ name: "ask", arguments: { message: "ভ্যাট সহ মোট কত?", conversation: "shop" } });
    const lastCall = provider?.calls.at(-1)?.messages ?? [];
    expect(lastCall.some((m) => String(m.content).includes("১৫০০ টাকার ১৫% ভ্যাট কত?"))).toBe(true);
    const [shop] = await sessions.list({ channel: MCP_CHANNEL });
    expect(shop?.externalId).toBe("shop");

    // new_conversation starts a fresh session under the same name.
    const fresh = await client.callTool({ name: "ask", arguments: { message: "hi", conversation: "shop", new_conversation: true } });
    expect((fresh.structuredContent as { sessionId: string }).sessionId).not.toBe(shop?.id);
    expect(await sessions.list({ channel: MCP_CHANNEL })).toHaveLength(2);
  });

  it("validates input and reports agent errors as tool errors", async () => {
    const { client } = await connect(failing);
    const tooLong = await client.callTool({ name: "ask", arguments: { message: "x".repeat(201) } });
    expect(tooLong.isError).toBe(true);
    const badName = await client.callTool({ name: "ask", arguments: { message: "hi", conversation: "../etc" } });
    expect(badName.isError).toBe(true);
    // The model is down, so the run fails and the tool result is an error.
    const failed = await client.callTool({ name: "ask", arguments: { message: "hi" } });
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ status: "error", conversation: "default" });
  });

  it("offers read-only knowledge search when the knowledge base is enabled", async () => {
    const { client } = await connect(failing, true);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "search_knowledge")?.annotations?.readOnlyHint).toBe(true);
    const res = await client.callTool({ name: "search_knowledge", arguments: { query: "ফেরত" } });
    expect((res.content as { text: string }[])[0]?.text).toContain("returns.md");
  });
});
