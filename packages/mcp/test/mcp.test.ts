import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigError, createLogger, type McpServerConfig } from "@banglaclaw/shared";
import { AllowlistPolicy, ToolRegistry, executeTool, type ToolContext } from "@banglaclaw/tools";
import { McpManager, flattenResult, interpolate, toolNameFor } from "../src/index.js";

const silent = createLogger({ write: () => {} });
const ctx: ToolContext = { runId: "r", sessionId: "s", timezone: "Asia/Dhaka", signal: new AbortController().signal };
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const stdio = (overrides: Partial<Extract<McpServerConfig, { transport: "stdio" }>> = {}): McpServerConfig => ({
  transport: "stdio",
  command: "node",
  args: [],
  env: {},
  enabled: true,
  timeoutMs: 5_000,
  connectTimeoutMs: 10_000,
  ...overrides,
});

function testServer(): McpServer {
  const server = new McpServer({ name: "test-server", version: "1.2.3" });
  server.registerTool("echo", { description: "Echo text", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } }, async ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text}` }],
  }));
  server.registerTool("getWeatherForecast", { description: "Weird name", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "sunny" }] }));
  server.registerTool("fail", { description: "Always fails", inputSchema: {} }, async () => ({ isError: true, content: [{ type: "text", text: "boom" }] }));
  server.registerTool("wipe_all", { description: "Deletes everything", inputSchema: {}, annotations: { destructiveHint: true } }, async () => ({
    content: [{ type: "text", text: "wiped" }],
  }));
  server.registerTool("slow", { description: "Never finishes", inputSchema: {} }, () => new Promise(() => {}));
  return server;
}

let managers: McpManager[] = [];
afterEach(async () => {
  await Promise.all(managers.map((m) => m.close()));
  managers = [];
});

async function inMemoryManager(extra: Record<string, McpServerConfig> = {}) {
  const manager = new McpManager({
    servers: { test: stdio({ timeoutMs: 300 }), ...extra },
    logger: silent,
    transportFactory: (name, config) => {
      if (name !== "test") throw new Error(`no factory for ${name} (${config.transport})`);
      const [client, server] = InMemoryTransport.createLinkedPair();
      void testServer().connect(server);
      return client;
    },
  });
  managers.push(manager);
  await manager.connectAll();
  return manager;
}

describe("helpers", () => {
  it("builds snake_case, length-limited tool names", () => {
    expect(toolNameFor("bangladesh", "list_divisions")).toBe("bangladesh__list_divisions");
    expect(toolNameFor("gh", "getWeatherForecast")).toBe("gh__get_weather_forecast");
    expect(toolNameFor("gh", "search-issues.v2")).toBe("gh__search_issues_v2");
    const long = toolNameFor("server", "x".repeat(100));
    expect(long).toHaveLength(64);
    expect(long).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(toolNameFor("server", "y".repeat(100))).not.toBe(long);
  });

  it("interpolates env references and fails on missing ones", () => {
    expect(interpolate("Bearer ${TOKEN}", { TOKEN: "abc" }, "h")).toBe("Bearer abc");
    expect(() => interpolate("${MISSING}", {}, "mcp.servers.x.env.K")).toThrow(ConfigError);
  });

  it("flattens content blocks and truncates", () => {
    const out = flattenResult(
      {
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "xx", mimeType: "image/png" },
          { type: "resource", resource: { uri: "file:///a.txt", text: "inline" } },
          { type: "resource_link", uri: "https://x", name: "doc" },
        ],
        structuredContent: { a: 1 },
      },
      30,
    );
    expect(out).toEqual({ content: 'hello\n[image image/png]\ninline\n…[truncated]', truncated: true, structured: { a: 1 } });
  });

  it("drops text that only repeats the structured content", () => {
    const structured = { matches: [1, 2] };
    expect(flattenResult({ content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured })).toEqual({ structured, truncated: false });
    expect(flattenResult({ content: [{ type: "text", text: "x".repeat(50) }], structuredContent: { big: "y".repeat(100) } }, 40)).toMatchObject({ truncated: true });
  });
});

describe("McpManager", () => {
  it("discovers tools with prefixed names, risk and JSON Schema", async () => {
    const manager = await inMemoryManager();
    const [status] = manager.status();
    expect(status).toMatchObject({ name: "test", state: "connected", serverInfo: { name: "test-server", version: "1.2.3" } });
    expect(status?.tools.sort()).toEqual(["test__echo", "test__fail", "test__get_weather_forecast", "test__slow", "test__wipe_all"]);

    const byName = new Map(manager.tools().map((t) => [t.name, t]));
    expect(byName.get("test__echo")?.risk).toBe("sensitive");
    expect(byName.get("test__wipe_all")?.risk).toBe("destructive");
    expect(byName.get("test__echo")?.description).toBe("[MCP test] Echo text");

    const registry = new ToolRegistry();
    for (const tool of manager.tools()) registry.register(tool);
    const spec = registry.toSpecs().find((s) => s.function.name === "test__echo");
    expect(spec?.function.parameters).toMatchObject({ type: "object", properties: { text: { type: "string" } }, required: ["text"] });
  });

  it("executes MCP tools through the normal permission-checked lifecycle", async () => {
    const manager = await inMemoryManager();
    const registry = new ToolRegistry();
    for (const tool of manager.tools()) registry.register(tool);
    const policy = new AllowlistPolicy(["test__*"]);
    const call = (name: string, args: unknown) => executeTool({ id: "1", name, args }, { registry, policy, ctx });

    const ok = await call("test__echo", { text: "salam" });
    expect(ok.audit.status).toBe("ok");
    expect(JSON.parse(ok.content)).toEqual({ content: "echo: salam", truncated: false });

    expect((await call("test__echo", { text: 42 })).audit.status).toBe("invalid_input");
    const failed = await call("test__fail", {});
    expect(failed.audit).toMatchObject({ status: "error", error: expect.stringContaining("boom") });
    expect((await call("test__wipe_all", {})).audit.status).toBe("denied");
    expect((await call("test__slow", {})).audit).toMatchObject({ status: "error", error: expect.stringMatching(/timed out|timeout/i) });

    const narrow = await executeTool({ id: "2", name: "test__echo", args: { text: "x" } }, { registry, policy: new AllowlistPolicy([]), ctx });
    expect(narrow.audit.status).toBe("denied");
  });

  it("reports failed and disabled servers without breaking the others", async () => {
    const manager = await inMemoryManager({
      broken: stdio({ command: "definitely-not-a-real-command-xyz", connectTimeoutMs: 3_000 }),
      off: stdio({ enabled: false }),
    });
    const status = new Map(manager.status().map((s) => [s.name, s]));
    expect(status.get("test")?.state).toBe("connected");
    expect(status.get("broken")?.state).toBe("failed");
    expect(status.get("off")).toMatchObject({ state: "disabled", tools: [] });
  });

  it("fails a server whose env references are missing", async () => {
    const manager = new McpManager({ servers: { s: stdio({ env: { TOKEN: "${NOPE_NOT_SET}" } }) }, env: {}, logger: silent });
    managers.push(manager);
    const [status] = await manager.connectAll();
    expect(status).toMatchObject({ state: "failed", error: expect.stringContaining("NOPE_NOT_SET") });
  });

  it("connects to the bundled bangladesh server over stdio", async () => {
    const manager = new McpManager({
      servers: {
        bangladesh: stdio({ args: ["--conditions=@banglaclaw/source", "--import", "tsx", "mcp-servers/bangladesh/src/bin.ts"] }),
      },
      baseDir: REPO_ROOT,
      logger: silent,
    });
    managers.push(manager);
    const [status] = await manager.connectAll();
    expect(status).toMatchObject({ state: "connected", serverInfo: { name: "banglaclaw-bangladesh" } });

    const registry = new ToolRegistry();
    for (const tool of manager.tools()) registry.register(tool);
    const result = await executeTool(
      { id: "1", name: "bangladesh__find_district", args: { query: "Comilla" } },
      { registry, policy: new AllowlistPolicy(["bangladesh__*"]), ctx },
    );
    expect(result.audit.status).toBe("ok");
    expect(result.audit.output).toEqual({ structured: { matches: [expect.objectContaining({ district: "Cumilla", division: "Chattogram" })] }, truncated: false });
  }, 20_000);
});
