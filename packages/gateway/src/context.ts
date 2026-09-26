import type { Hono } from "hono";
import type { AgentRuntime } from "@entrogic-net/agent";
import type { KnowledgeBase, LongTermMemory } from "@entrogic-net/knowledge";
import type { ApiKeyAuthenticator, Principal } from "@entrogic-net/auth";
import type { Deliver, RunStore, Session, SessionStore } from "@entrogic-net/session";
import { ConcurrencyLimiter, RateLimiter, type AuditStore, type BanglaClawConfig, type Logger, type Transcriber } from "@entrogic-net/shared";
import type { SkillSet } from "@entrogic-net/skills";
import type { PermissionPolicy, ToolRegistry } from "@entrogic-net/tools";
import { HttpError } from "./errors.js";
import { scopedExternalId } from "./serialize.js";
import { SessionEvents } from "./session-events.js";

export type GatewayConfig = BanglaClawConfig["gateway"];

/** Hono variables set by the gateway's request middleware. */
export type GatewayEnv = { Variables: { requestId: string; principal: Principal; log: Logger; ip: string | undefined } };

/** Per-user files behind /v1/workspace (structurally the Workspace of @entrogic-net/workspace, docs/24). */
export interface GatewayWorkspace {
  list(owner: string, dir?: string): Promise<{ entries: { path: string; type: "file" | "dir"; size: number; modified: string }[]; truncated: boolean }>;
  read(owner: string, path: string, window?: { offset?: number; limit?: number }): Promise<{ path: string; content: string; totalLines: number; truncated: boolean }>;
  delete(owner: string, path: string): Promise<{ path: string; trashed: string }>;
  history(owner: string, path: string): Promise<{ path: string; versions: { version: number; savedAt: string; size: number }[]; inTrash: boolean }>;
  restore(owner: string, path: string, version?: number): Promise<{ path: string; restoredFrom: "history" | "trash"; bytes: number }>;
}

/** Stores files uploaded through POST /v1/workspace/uploads (the CLI extracts text like chat uploads). */
export interface GatewayUploads {
  maxBytes: number;
  save(owner: string, file: { filename: string; data: Uint8Array }): Promise<{ path: string; characters: number }>;
}

/** The embeddable widget (channels.widget without `enabled`), plus the secret that signs visitor tokens. */
export type WidgetOptions = Omit<BanglaClawConfig["channels"]["widget"], "enabled"> & { secret: string };

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
  /** Serve the embeddable website widget (/widget.js, /widget/frame, /widget/api/*) for anonymous visitors. */
  widget?: WidgetOptions;
  /** The caller's workspace files at /v1/workspace (docs/24); absent = those routes answer 404. */
  workspace?: GatewayWorkspace;
  /** Uploads into the workspace (POST /v1/workspace/uploads). */
  uploads?: GatewayUploads;
  /** Speech-to-text for POST /v1/transcriptions (the web chat's microphone). */
  transcriber?: Transcriber;
  /** Language hint for transcriptions, e.g. "bn"; undefined lets the recogniser detect it. */
  transcriptionLanguage?: string;
  knowledge?: { kb: KnowledgeBase; searchLimit: number; minScore: number };
  memory?: LongTermMemory;
  /** Delivers operator replies to channel users (Telegram, WhatsApp). API clients get them as session events. */
  deliver?: Deliver;
  /** Security audit log; admins read it at GET /v1/audit. */
  audit?: AuditStore;
  /** Prometheus metrics served at GET /metrics (bearer `token` required when set). */
  metrics?: GatewayMetrics;
  /** Built dashboard (apps/dashboard/dist) served at /admin. */
  dashboardDir?: string;
  /** USD per 1M tokens by provider id, for cost estimates in /v1/admin/stats. */
  pricing?: Record<string, { input: number; output: number }>;
  /** Timezone for daily analytics buckets. */
  timezone?: string;
  logger?: Logger;
}

export interface GatewayMetrics {
  observeHttp(method: string, route: string, status: number, durationMs: number): void;
  requestStarted(): () => void;
  render(): Promise<string>;
  readonly contentType: string;
  token?: string;
}

export const API_CHANNEL = "api";
/** Limits for session event subscriptions: SSE streams per API key, subscriptions per WebSocket. */
export const MAX_EVENT_STREAMS_PER_KEY = 10;
export const MAX_SUBSCRIPTIONS_PER_SOCKET = 20;

/** Shared per-gateway state used by the REST and WebSocket handlers. */
export class GatewayContext {
  readonly rate: RateLimiter;
  readonly concurrency: ConcurrencyLimiter;
  /** Operator replies and releases, pushed to clients subscribed over WebSocket or SSE. */
  readonly events = new SessionEvents();
  /** Open SSE event streams per API key. */
  readonly eventStreams = new ConcurrencyLimiter(MAX_EVENT_STREAMS_PER_KEY);

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
