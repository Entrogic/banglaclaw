import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { ApiKeyAuthenticator, Principal } from "@entrogic-net/auth";
import { windowStart, type RunStats } from "@entrogic-net/session";
import type { EvalRun, EvalStore, NewAuditEvent } from "@entrogic-net/shared";
import type { GatewayDeps } from "./context.js";
import { HttpError } from "./errors.js";
import { evalRunBody, limitQuery } from "./schemas.js";
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

/** Eval uploads carry every case's input and output, so they get more room than the default 256 KB. */
export const EVAL_BODY_LIMIT = 10 * 1024 * 1024;

export function evalRunJson(r: EvalRun) {
  return { ...r, createdAt: r.createdAt.toISOString() };
}

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
    // Days are calendar days in the configured timezone, so the window starts at local midnight.
    const since = windowStart(until, days, deps.timezone ?? "UTC");
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

  const evals = (): EvalStore => {
    if (deps.evals === undefined) throw new HttpError(404, "evals_disabled", "Eval results are not stored on this gateway");
    return deps.evals;
  };

  app.get("/evals", async (c) => {
    const name = c.req.query("name")?.trim();
    const runs = await evals().list({ limit: limitQuery(200, 50).parse(c.req.query("limit")), ...(name !== undefined && name !== "" && { name }) });
    return c.json({ evals: runs.map(evalRunJson) });
  });

  /** Records a finished evaluation run (the DeepEval harness posts here, docs/26). */
  app.post(
    "/evals",
    bodyLimit({ maxSize: EVAL_BODY_LIMIT, onError: () => { throw new HttpError(413, "payload_too_large", "Eval upload too large"); } }),
    async (c) => {
      const store = evals();
      const body = await helpers.parseJson(c, evalRunBody);
      const principal = c.get("principal");
      const run = await store.save({ ...body, agentModel: body.agentModel ?? deps.agent.model, createdBy: principal.user.id });
      helpers.audit(c, { action: "eval.recorded", outcome: "success", actorId: principal.user.id, actorName: principal.user.name, target: run.id, metadata: { name: run.name, cases: run.caseCount, passed: run.passedCount } });
      return c.json({ eval: evalRunJson(run) }, 201);
    },
  );

  app.get("/evals/:id", async (c) => {
    const found = await evals().get(c.req.param("id"));
    if (found === undefined) throw new HttpError(404, "eval_not_found", "Eval run not found");
    return c.json({ eval: evalRunJson(found.run), cases: found.cases });
  });

  app.delete("/evals/:id", async (c) => {
    if (!(await evals().delete(c.req.param("id")))) throw new HttpError(404, "eval_not_found", "Eval run not found");
    const principal = c.get("principal");
    helpers.audit(c, { action: "eval.deleted", outcome: "success", actorId: principal.user.id, actorName: principal.user.name, target: c.req.param("id") });
    return c.body(null, 204);
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
