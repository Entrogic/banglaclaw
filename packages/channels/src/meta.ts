import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

/** Verifies Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret). */
export function verifySignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (header === undefined || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Meta webhook verification handshake (GET with hub.mode, hub.verify_token, hub.challenge). */
export function verifyHandshake(c: Context, verifyToken: string): Response {
  const mode = c.req.query("hub.mode");
  const token = Buffer.from(c.req.query("hub.verify_token") ?? "");
  const expected = Buffer.from(verifyToken);
  if (mode === "subscribe" && token.length === expected.length && timingSafeEqual(token, expected)) return c.text(c.req.query("hub.challenge") ?? "");
  return c.text("Forbidden", 403);
}
