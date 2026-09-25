import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { createLogger, type Logger, type McpServerConfig } from "@banglaclaw/shared";
import type { AnyTool } from "@banglaclaw/tools";
import { toolFromMcp } from "./convert.js";
import { interpolate, interpolateMap } from "./interpolate.js";

export type McpServerState = "connected" | "failed" | "disabled";

export interface McpServerStatus {
  name: string;
  transport: McpServerConfig["transport"];
  state: McpServerState;
  error?: string;
  /** BanglaClaw tool names discovered on this server. */
  tools: string[];
  serverInfo?: { name: string; version: string };
}

export type TransportFactory = (name: string, config: McpServerConfig) => Transport;

export interface McpManagerOptions {
  servers: Record<string, McpServerConfig>;
  /** Base for relative stdio `cwd` (config file directory). */
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  clientVersion?: string;
  maxOutputChars?: number;
  /** Override transport creation (tests, embedding). */
  transportFactory?: TransportFactory;
}

interface Connection {
  client: Client;
  transport: Transport;
}

const STDERR_TAIL_LINES = 20;

/**
 * Owns MCP client connections (docs/10): connects to each configured server, discovers its
 * tools, wraps them as BanglaClawTools and closes everything on shutdown. A server that fails
 * to connect is reported, not fatal — the agent keeps working with the remaining tools.
 */
export class McpManager {
  readonly #options: McpManagerOptions;
  readonly #logger: Logger;
  readonly #connections = new Map<string, Connection>();
  readonly #tools: AnyTool[] = [];
  readonly #status: McpServerStatus[] = [];

  constructor(options: McpManagerOptions) {
    this.#options = options;
    this.#logger = options.logger ?? createLogger({ level: "warn" });
  }

  /** Connects all enabled servers in parallel. Safe to call once. */
  async connectAll(): Promise<McpServerStatus[]> {
    const entries = Object.entries(this.#options.servers);
    const results = await Promise.all(entries.map(([name, config]) => this.#connect(name, config)));
    this.#status.push(...results);
    return this.status();
  }

  status(): McpServerStatus[] {
    return this.#status.map((s) => ({ ...s, tools: [...s.tools] }));
  }

  tools(): AnyTool[] {
    return [...this.#tools];
  }

  async close(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.allSettled(connections.map((c) => c.client.close()));
  }

  async #connect(name: string, config: McpServerConfig): Promise<McpServerStatus> {
    const base: McpServerStatus = { name, transport: config.transport, state: "disabled", tools: [] };
    if (!config.enabled) return base;

    const log = this.#logger.child({ mcpServer: name });
    const stderrTail: string[] = [];
    let transport: Transport | undefined;
    const client = new Client({ name: "banglaclaw", version: this.#options.clientVersion ?? "0.0.0" });

    try {
      transport = this.#options.transportFactory?.(name, config) ?? this.#createTransport(name, config, stderrTail, log);
      const signal = AbortSignal.timeout(config.connectTimeoutMs);
      await client.connect(transport, { signal, timeout: config.connectTimeoutMs });
      const mcpTools = await listAllTools(client, signal, config.connectTimeoutMs);

      const seen = new Set(this.#tools.map((t) => t.name));
      const tools: AnyTool[] = [];
      for (const mcpTool of mcpTools) {
        const tool = toolFromMcp(mcpTool, {
          server: name,
          client,
          timeoutMs: config.timeoutMs,
          ...(this.#options.maxOutputChars !== undefined && { maxOutputChars: this.#options.maxOutputChars }),
        });
        if (seen.has(tool.name)) {
          log.warn("skipping MCP tool with a duplicate name", { tool: mcpTool.name, name: tool.name });
          continue;
        }
        seen.add(tool.name);
        tools.push(tool);
      }

      this.#connections.set(name, { client, transport });
      this.#tools.push(...tools);
      const info = client.getServerVersion();
      log.info("MCP server connected", { tools: tools.length, server: info?.name, version: info?.version });
      return {
        ...base,
        state: "connected",
        tools: tools.map((t) => t.name),
        ...(info !== undefined && { serverInfo: { name: info.name, version: info.version } }),
      };
    } catch (error) {
      await client.close().catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      const tail = stderrTail.length > 0 ? `\n${stderrTail.join("\n")}` : "";
      // Reported through status(); callers decide how to surface it.
      log.info("MCP server failed to connect", { error: message });
      return { ...base, state: "failed", error: `${message}${tail}` };
    }
  }

  #createTransport(name: string, config: McpServerConfig, stderrTail: string[], log: Logger): Transport {
    const env = this.#options.env ?? process.env;
    const where = `mcp.servers.${name}`;

    if (config.transport === "http") {
      return new StreamableHTTPClientTransport(new URL(interpolate(config.url, env, `${where}.url`)), {
        requestInit: { headers: interpolateMap(config.headers, env, `${where}.headers`) },
      });
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args.map((a, i) => interpolate(a, env, `${where}.args[${i}]`)),
      // Only safe defaults (PATH, HOME, …) plus explicit env — never the full parent environment with its secrets.
      env: { ...getDefaultEnvironment(), ...interpolateMap(config.env, env, `${where}.env`) },
      cwd: resolve(this.#options.baseDir ?? process.cwd(), config.cwd ?? "."),
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim() === "") continue;
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        log.debug("MCP server stderr", { line });
      }
    });
    return transport;
  }
}

async function listAllTools(client: Client, signal: AbortSignal, timeout: number): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor !== undefined ? { cursor } : {}, { signal, timeout });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools;
}
