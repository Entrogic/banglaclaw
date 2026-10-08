import { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory, RestTransportFactory } from "@a2a-js/sdk/client";
import { createLogger, interpolateMap, type A2aAgentConfig, type Logger } from "@entrogic-net/shared";
import type { AnyTool } from "@entrogic-net/tools";
import { describeAgent } from "./convert.js";
import { Conversations } from "./conversations.js";
import { a2aAgentTool } from "./tool.js";

export type A2aAgentState = "connected" | "failed" | "disabled";

export interface A2aAgentStatus {
  name: string;
  url: string;
  state: A2aAgentState;
  error?: string;
  /** BanglaClaw tool name, when connected. */
  tool?: string;
  card?: { name: string; version: string; protocolVersion: string; skills: string[] };
}

export interface A2aManagerOptions {
  agents: Record<string, A2aAgentConfig>;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  /** Override `fetch` (tests, embedding). */
  fetch?: typeof fetch;
  maxOutputChars?: number;
  /** GetTask poll interval for agents that answer before their task is done. */
  pollIntervalMs?: number;
}

/**
 * Remote A2A agents as tools (docs/25): fetches each configured agent's card, picks a transport
 * (JSON-RPC or HTTP+JSON, protocol v1.0 or v0.3) and wraps the agent as `a2a__<name>`. An agent
 * that cannot be reached is reported through status(), never thrown.
 */
export class A2aManager {
  readonly #options: A2aManagerOptions;
  readonly #logger: Logger;
  readonly #tools: AnyTool[] = [];
  readonly #status: A2aAgentStatus[] = [];

  constructor(options: A2aManagerOptions) {
    this.#options = options;
    this.#logger = options.logger ?? createLogger({ level: "warn" });
  }

  /** Fetches all enabled agent cards in parallel. Safe to call once. */
  async connectAll(): Promise<A2aAgentStatus[]> {
    const results = await Promise.all(Object.entries(this.#options.agents).map(([name, config]) => this.#connect(name, config)));
    for (const { status, tool } of results) {
      this.#status.push(status);
      if (tool !== undefined) this.#tools.push(tool);
    }
    return this.status();
  }

  status(): A2aAgentStatus[] {
    return this.#status.map((s) => ({ ...s, ...(s.card !== undefined && { card: { ...s.card, skills: [...s.card.skills] } }) }));
  }

  tools(): AnyTool[] {
    return [...this.#tools];
  }

  /** Nothing is held open between calls; present for symmetry with McpManager. */
  async close(): Promise<void> {}

  async #connect(name: string, config: A2aAgentConfig): Promise<{ status: A2aAgentStatus; tool?: AnyTool }> {
    const base: A2aAgentStatus = { name, url: config.url, state: "disabled" };
    if (!config.enabled) return { status: base };
    const log = this.#logger.child({ a2aAgent: name });
    try {
      const headers = interpolateMap(config.headers, this.#options.env ?? process.env, `a2a.agents.${name}.headers`);
      const fetchImpl = withHeaders(this.#options.fetch ?? fetch, new URL(config.url).origin, headers);
      const legacyCompat = { enabled: true };
      const factory = new ClientFactory({
        transports: [new JsonRpcTransportFactory({ fetchImpl, legacyCompat }), new RestTransportFactory({ fetchImpl, legacyCompat })],
        cardResolver: new DefaultAgentCardResolver({ fetchImpl: withTimeout(fetchImpl, config.connectTimeoutMs), legacyCompat }),
      });
      // An empty path makes the resolver fetch exactly this URL.
      const client = await factory.createFromUrl(`${config.url}${config.cardPath}`, "");
      const card = await client.getAgentCard();
      const tool = a2aAgentTool({
        agent: name,
        description: describeAgent(name, card, config.description),
        client,
        timeoutMs: config.timeoutMs,
        conversations: new Conversations(),
        ...(this.#options.maxOutputChars !== undefined && { maxOutputChars: this.#options.maxOutputChars }),
        ...(this.#options.pollIntervalMs !== undefined && { pollIntervalMs: this.#options.pollIntervalMs }),
      });
      log.info("A2A agent connected", { agent: card.name, version: card.version, protocol: client.protocolVersion });
      return {
        status: {
          ...base,
          state: "connected",
          tool: tool.name,
          card: { name: card.name, version: card.version, protocolVersion: client.protocolVersion, skills: card.skills.map((s) => s.name || s.id) },
        },
        tool,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.info("A2A agent unavailable", { error: message });
      return { status: { ...base, state: "failed", error: message } };
    }
  }
}

/**
 * Adds the configured headers (usually `Authorization`) to requests for the configured origin only:
 * a card that points its interface elsewhere must not receive the credentials.
 */
export function withHeaders(fetchImpl: typeof fetch, origin: string, headers: Record<string, string>): typeof fetch {
  if (Object.keys(headers).length === 0) return fetchImpl;
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== origin) return fetchImpl(input, init);
    const merged = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => merged.set(key, value));
    for (const [key, value] of Object.entries(headers)) if (!merged.has(key)) merged.set(key, value);
    return fetchImpl(input, { ...init, headers: merged });
  };
}

function withTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return (input, init) => fetchImpl(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) });
}
