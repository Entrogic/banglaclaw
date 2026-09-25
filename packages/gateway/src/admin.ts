import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { ApiKeyAuthenticator, Principal } from "@banglaclaw/auth";
import type { RunStats } from "@banglaclaw/session";
import type { NewAuditEvent } from "@banglaclaw/shared";
import type { GatewayDeps } from "./context.js";
import { HttpError } from "./errors.js";
import { limitQuery } from "./schemas.js";
import { messageJson, runJson, sessionJson } from "./serialize.js";

export type Pricing = Record<string, { input: number; output: number }>;

/** Adds estimated USD cost per provider from `pricing` (USD per 1M tokens); unknown models have no cost. */
export function withCosts(stats: RunStats, pricing: Pricing) {
  const byProvider = stats.byProvider.map((p) => {
    const price = pricing[p.provider];
    return price === undefined ? p : { ...p, costUsd: Math.round(((p.inputTokens * price.input + p.outputTokens * price.output) / 1_000_000) * 10_000) / 10_000 };
  });
  const priced = byProvider.filter((p): p is (typeof byProvider)[number] & { costUsd: number } => "costUsd" in p);
  return { ...stats, byProvider, ...(priced.length > 0 && { totalCostUsd: Math.round(priced.reduce((a, p) => a + p.costUsd, 0) * 10_000) / 10_000 }) };
}

const createKeyBody = z.strictObject({
  user: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100).default("default"),
  role: z.enum(["user", "operator", "admin"]).optional(),
  scopes: z.array(z.enum(["read", "run"])).min(1).default(["read", "run"]),
});

type Env = { Variables: { principal: Principal; requestId: string; ip: string | undefined } };

/**
 * Admin API (admin role): analytics, all-user conversations, API-key management.
 * Mounted under the authenticated /v1 app, so key scopes and rate limits already apply.
 */
export function adminRoutes(
  deps: GatewayDeps,
  helpers: {
    requireRole: (c: Context, role: "operator" | "admin") => void;
    audit: (c: Context, event: Omit<NewAuditEvent, "ip" | "requestId">) => void;
    parseJson: <T>(c: Context, schema: z.ZodType<T>) => Promise<T>;
  },
) {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    helpers.requireRole(c, "admin");
    await next();
  });

  app.get("/stats", async (c) => {
    const days = limitQuery(90, 7).parse(c.req.query("days"));
    const until = new Date();
    const since = new Date(until.getTime() - (days - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const stats = await deps.runs.stats({ since, until, timezone: deps.timezone ?? "UTC" });
    return c.json({ days, timezone: deps.timezone ?? "UTC", ...withCosts(stats, deps.pricing ?? {}) });
  });

  app.get("/sessions", async (c) => {
    const status = c.req.query("status");
    if (status !== undefined && status !== "active" && status !== "handoff") throw new HttpError(400, "invalid_request", "status must be active or handoff");
    const channel = c.req.query("channel");
    const q = c.req.query("q");
    const sessions = await deps.sessions.list({
      limit: limitQuery(200, 50).parse(c.req.query("limit")),
      ...(status !== undefined && { status }),
      ...(channel !== undefined && channel !== "" && { channel }),
      ...(q !== undefined && q !== "" && { query: q.slice(0, 100) }),
    });
    const users = new Map((await deps.auth.store.listUsers()).map((u) => [u.id, u.name]));
    const rows = await Promise.all(
      sessions.map(async (s) => ({ ...sessionJson(s), ...(s.userId !== undefined && { userId: s.userId, userName: users.get(s.userId) }), messageCount: await deps.sessions.countMessages(s.id) })),
    );
    return c.json({ sessions: rows });
  });

  app.get("/sessions/:id", async (c) => {
    const session = await deps.sessions.get(c.req.param("id"));
    if (session === undefined) throw new HttpError(404, "session_not_found", "Session not found");
    const [messages, runs] = await Promise.all([
      deps.sessions.recentMessages(session.id, limitQuery(500, 100).parse(c.req.query("limit"))),
      deps.runs.listBySession(session.id, { limit: 50 }),
    ]);
    return c.json({ session: sessionJson(session), messages: messages.map(messageJson), runs: runs.map(runJson) });
  });

  const auth = (): ApiKeyAuthenticator => deps.auth;

  app.get("/keys", async (c) => {
    const users = new Map((await auth().store.listUsers()).map((u) => [u.id, u]));
    const keys = await auth().store.listApiKeys();
    return c.json({
      keys: keys.map(({ hash: _hash, ...k }) => ({
        id: k.id,
        name: k.name,
        scopes: k.scopes,
        user: users.get(k.userId)?.name ?? k.userId,
        role: users.get(k.userId)?.role ?? "user",
        status: k.revokedAt !== undefined ? "revoked" : "active",
        createdAt: k.createdAt.toISOString(),
        ...(k.lastUsedAt !== undefined && { lastUsedAt: k.lastUsedAt.toISOString() }),
        ...(k.revokedAt !== undefined && { revokedAt: k.revokedAt.toISOString() }),
      })),
    });
  });

  app.post("/keys", async (c) => {
    const body = await helpers.parseJson(c, createKeyBody);
    const issued = await auth().issueKey(body.user, body.name, body.role, body.scopes);
    const principal = c.get("principal");
    helpers.audit(c, { action: "key.created", outcome: "success", actorId: principal.user.id, actorName: principal.user.name, target: issued.key.id, metadata: { user: issued.user.name, role: issued.user.role, scopes: issued.key.scopes, via: "api" } });
    return c.json({ key: { id: issued.key.id, name: issued.key.name, scopes: issued.key.scopes, user: issued.user.name, role: issued.user.role }, token: issued.token }, 201);
  });

  app.post("/keys/:id/revoke", async (c) => {
    const id = c.req.param("id");
    const principal = c.get("principal");
    if (id === principal.key.id) throw new HttpError(409, "cannot_revoke_self", "You cannot revoke the key you are signed in with");
    if (!(await auth().store.revokeApiKey(id))) throw new HttpError(404, "key_not_found", "No active key with that id");
    helpers.audit(c, { action: "key.revoked", outcome: "success", actorId: principal.user.id, actorName: principal.user.name, target: id, metadata: { via: "api" } });
    return c.json({ revoked: id });
  });

  return app;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export const DASHBOARD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Serves the built dashboard SPA from `dir` at /admin (hashed assets cached; unknown paths → index.html). */
export function dashboardRoutes(dir: string) {
  const root = resolve(dir);
  const app = new Hono();
  const send = (c: Context, file: string, cache: string) => {
    c.header("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    c.header("Cache-Control", cache);
    c.header("Content-Security-Policy", DASHBOARD_CSP);
    return c.body(readFileSync(file));
  };
  app.get("/admin", (c) => c.redirect("/admin/", 301));
  app.get("/admin/*", (c) => {
    const rel = decodeURIComponent(c.req.path.slice("/admin/".length));
    const target = normalize(join(root, rel));
    if (target !== root && !target.startsWith(root + sep)) throw new HttpError(404, "not_found", "Route not found");
    if (rel !== "" && existsSync(target) && statSync(target).isFile()) {
      return send(c, target, rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    }
    if (extname(rel) !== "") throw new HttpError(404, "not_found", "Route not found");
    return send(c, join(root, "index.html"), "no-cache");
  });
  return app;
}
