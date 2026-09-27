import { createHash } from "node:crypto";
import { A2A_VERSION_HEADER, AGENT_CARD_PATH } from "@a2a-js/sdk";
import { LegacyJsonRpcTransportHandler } from "@a2a-js/sdk/compat/v0_3/server";
import { A2A_ERROR_CODE } from "@a2a-js/sdk/errors";
import { DefaultRequestHandler, InMemoryTaskStore, JsonRpcTransportHandler, defaultServerCallContextBuilder, validateVersion } from "@a2a-js/sdk/server";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import { createLogger } from "@entrogic-net/shared";
import type { A2aOptions, GatewayContext, GatewayEnv } from "../context.js";
import { A2A_PATH, agentCard, agentCardJson, legacyAgentCardJson, type CardInput } from "./card.js";
import { BanglaClawExecutor, PrincipalUser } from "./executor.js";

const CARD_MAX_AGE = 300;

/** A header value is a v0.3 request when it is missing or in [0.3, 1.0), like the SDK's own routers. */
function isLegacy(version: string | undefined): boolean {
  const v = version?.trim() ?? "";
  if (v === "") return true;
  const [major, minor = "0"] = v.split(".");
  return Number(major) === 0 && Number(minor) >= 3;
}

type JsonRpcId = string | number | null;
const rpcId = (body: unknown): JsonRpcId => {
  if (typeof body !== "object" || body === null || !("id" in body)) return null;
  const { id } = body;
  return typeof id === "string" || typeof id === "number" ? id : null;
};

/**
 * BanglaClaw as an A2A server (docs/25, ADR-0015): the public agent card and JSON-RPC at /a2a,
 * protocol v1.0 plus v0.3 for older clients. Calls use the same API keys, rate limit and scopes as
 * /v1; tasks are kept in memory per user, while the conversation itself lives in the session store.
 */
export function a2aRoutes(gw: GatewayContext, options: A2aOptions, auth: MiddlewareHandler<GatewayEnv>[]): Hono<GatewayEnv> {
  const app = new Hono<GatewayEnv>();
  const logger = (gw.deps.logger ?? createLogger({ level: "warn" })).child({ component: "a2a" });
  const input: CardInput = {
    name: gw.deps.agent.name,
    version: gw.deps.version,
    ...(options.description !== undefined && { description: options.description }),
    skills: gw.deps.skills.list().map((s) => ({ name: s.name, description: s.description, triggers: s.triggers })),
  };
  // The handler's card only drives version checks; the served card carries the caller-visible URL.
  const handler = new DefaultRequestHandler(agentCard(input, options.publicUrl ?? ""), new InMemoryTaskStore(), new BanglaClawExecutor(gw, logger), undefined, undefined, undefined, undefined, undefined, {
    // Tasks waiting on a human (handoff) resume with a new message, not on a kept-open bus.
    keepBusAliveStates: [],
  });
  const jsonRpc = new JsonRpcTransportHandler(handler);
  const legacyJsonRpc = new LegacyJsonRpcTransportHandler(handler);
  const baseUrl = (c: Context) => options.publicUrl ?? new URL(c.req.url).origin;

  app.get(AGENT_CARD_PATH, (c) => {
    const legacy = isLegacy(c.req.header(A2A_VERSION_HEADER));
    const body = JSON.stringify(legacy ? legacyAgentCardJson(input, baseUrl(c)) : agentCardJson(input, baseUrl(c)));
    const etag = `W/"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
    c.header("ETag", etag);
    c.header("Vary", A2A_VERSION_HEADER);
    c.header("Cache-Control", `public, max-age=${CARD_MAX_AGE}`);
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    return c.body(body, 200, { "Content-Type": "application/json" });
  });

  app.use(A2A_PATH, ...auth);
  app.post(A2A_PATH, async (c) => {
    const requestedVersion = c.req.header(A2A_VERSION_HEADER);
    const legacy = isLegacy(requestedVersion);
    const mapError = legacy ? LegacyJsonRpcTransportHandler.mapToLegacyJSONRPCError : JsonRpcTransportHandler.mapToJSONRPCError;
    const rpcError = (id: JsonRpcId, error: { code: number; message: string; data?: unknown }) => ({ jsonrpc: "2.0" as const, id, error });

    const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== undefined && contentType !== "application/json") {
      return c.json(rpcError(null, { code: A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED, message: "Content-Type must be application/json" }));
    }
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return c.json(rpcError(null, { code: A2A_ERROR_CODE.PARSE_ERROR, message: "Invalid JSON payload." }));
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json(rpcError(null, { code: A2A_ERROR_CODE.INVALID_REQUEST, message: "Expected one JSON-RPC request object." }));
    }
    const request = body as Record<string, unknown>;
    const id = rpcId(request);

    let result: Awaited<ReturnType<JsonRpcTransportHandler["handle"]>> | Awaited<ReturnType<LegacyJsonRpcTransportHandler["handle"]>>;
    try {
      const context = defaultServerCallContextBuilder({
        extensions: undefined,
        user: new PrincipalUser(c.get("principal")),
        headers: {},
        ...(requestedVersion !== undefined && { requestedVersion }),
      });
      validateVersion(context.requestedVersion, await handler.getAgentCard(), "JSONRPC");
      result = await (legacy ? legacyJsonRpc : jsonRpc).handle(request, context);
    } catch (error) {
      const mapped = mapError(error);
      if (mapped.code === A2A_ERROR_CODE.INTERNAL_ERROR) c.get("log").error("A2A request failed", { error });
      return c.json(rpcError(id, mapped), mapped.code === A2A_ERROR_CODE.INTERNAL_ERROR ? 500 : 200);
    }

    if (!(Symbol.asyncIterator in result)) return c.json(result);

    // Errors before the first event still get a plain JSON-RPC response.
    const iterator = result[Symbol.asyncIterator]();
    let first: IteratorResult<unknown>;
    try {
      first = await iterator.next();
    } catch (error) {
      return c.json(rpcError(id, mapError(error)));
    }
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      try {
        if (first.done !== true) await stream.writeSSE({ data: JSON.stringify(first.value) });
        for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
          if (stream.aborted) break; // the task keeps running; clients can resubscribe or poll
          await stream.writeSSE({ data: JSON.stringify(next.value) });
        }
      } catch (error) {
        c.get("log").warn("A2A stream failed", { error });
        await stream.writeSSE({ event: "error", data: JSON.stringify(rpcError(id, mapError(error))) });
      }
    });
  });

  return app;
}
