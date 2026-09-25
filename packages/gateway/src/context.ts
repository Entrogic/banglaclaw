import type { Hono } from "hono";
import type { AgentRuntime } from "@banglaclaw/agent";
import type { ApiKeyAuthenticator, Principal } from "@banglaclaw/auth";
import type { RunStore, Session, SessionStore } from "@banglaclaw/session";
import { ConcurrencyLimiter, RateLimiter, type BanglaClawConfig, type Logger } from "@banglaclaw/shared";
import type { SkillSet } from "@banglaclaw/skills";
import type { PermissionPolicy, ToolRegistry } from "@banglaclaw/tools";
import { HttpError } from "./errors.js";
import { scopedExternalId } from "./serialize.js";

export type GatewayConfig = BanglaClawConfig["gateway"];

export interface GatewayDeps {
  runtime: AgentRuntime;
  sessions: SessionStore;
  runs: RunStore;
  auth: ApiKeyAuthenticator;
  registry: ToolRegistry;
  policy: PermissionPolicy;
  skills: SkillSet;
  agent: { name: string; model: string };
  config: GatewayConfig;
  version: string;
  /** Extra apps mounted at the root without /v1 API-key auth (channel webhooks verify their own signatures). */
  routes?: Hono[];
  /** Serve the browser chat page at /chat. */
  webChat?: boolean;
  logger?: Logger;
}

export const API_CHANNEL = "api";

/** Shared per-gateway state used by the REST and WebSocket handlers. */
export class GatewayContext {
  readonly rate: RateLimiter;
  readonly concurrency: ConcurrencyLimiter;

  constructor(readonly deps: GatewayDeps) {
    this.rate = new RateLimiter(deps.config.rateLimit.requestsPerMinute);
    this.concurrency = new ConcurrencyLimiter(deps.config.rateLimit.maxConcurrentRuns);
  }

  /** A session the principal owns. Other users' sessions read as "not found" to avoid leaking ids. */
  async ownedSession(principal: Principal, id: string): Promise<Session> {
    const session = await this.deps.sessions.get(id);
    if (session === undefined || session.userId !== principal.user.id) {
      throw new HttpError(404, "session_not_found", "Session not found");
    }
    return session;
  }

  /** Resolves the session for a run request: explicit id, the user's external id, or a new session. */
  async resolveSession(principal: Principal, input: { sessionId?: string; externalId?: string }): Promise<{ session: Session; created: boolean }> {
    if (input.sessionId !== undefined) return { session: await this.ownedSession(principal, input.sessionId), created: false };
    if (input.externalId !== undefined) {
      const scoped = scopedExternalId(principal.user.id, input.externalId);
      const existing = await this.deps.sessions.findByExternalId(API_CHANNEL, scoped);
      if (existing !== undefined) return { session: existing, created: false };
      return { session: await this.createSession(principal, input.externalId), created: true };
    }
    return { session: await this.createSession(principal), created: true };
  }

  async createSession(principal: Principal, externalId?: string): Promise<Session> {
    return this.deps.sessions.create({
      channel: API_CHANNEL,
      agentId: this.deps.agent.name,
      userId: principal.user.id,
      ...(externalId !== undefined && { externalId: scopedExternalId(principal.user.id, externalId) }),
    });
  }

  /** Reserves a run slot for the key, or throws 429. */
  acquireRun(principal: Principal): () => void {
    const release = this.concurrency.acquire(principal.key.id);
    if (release === undefined) {
      throw new HttpError(429, "too_many_concurrent_runs", `At most ${this.concurrency.max} runs may be in flight per API key`, {
        "Retry-After": "1",
      });
    }
    return release;
  }
}
