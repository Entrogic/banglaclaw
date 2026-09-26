import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Principal } from "@entrogic-net/auth";
import type { Session } from "@entrogic-net/session";
import { MAX_EVENT_STREAMS_PER_KEY, type GatewayContext } from "./context.js";
import { HttpError } from "./errors.js";
import type { SessionEvent } from "./session-events.js";

const KEEPALIVE_MS = 25_000;

/**
 * GET /v1/sessions/:id/events: a Server-Sent Events stream of session events (operator replies,
 * handoff releases) until the client disconnects. Starts with a `ready` event; `ping` every 25 s.
 */
export function respondWithSessionEvents(c: Context, gw: GatewayContext, principal: Principal, session: Session) {
  const release = gw.eventStreams.acquire(principal.key.id);
  if (release === undefined) {
    throw new HttpError(429, "too_many_event_streams", `At most ${MAX_EVENT_STREAMS_PER_KEY} event streams may be open per API key`);
  }
  return streamSSE(c, async (stream) => {
    // Serialise writes so events stay in order.
    let pending = Promise.resolve();
    const send = (event: string, data: unknown) => {
      pending = pending.then(() => (stream.aborted ? undefined : stream.writeSSE({ event, data: JSON.stringify(data) })));
    };
    const unsubscribe = gw.events.subscribe(session.id, (e: SessionEvent) => send(e.type, e));
    const keepalive = setInterval(() => send("ping", {}), KEEPALIVE_MS);
    try {
      send("ready", { sessionId: session.id, status: session.status });
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    } finally {
      clearInterval(keepalive);
      unsubscribe();
      release();
    }
  });
}
