import type { Session } from "./session.js";

/**
 * Who owns per-person data (long-term memories, workspace files) for a session. Always derived
 * from the session, never from model input:
 * - gateway sessions → the API user
 * - channel sessions → the channel conversation (Telegram chat, WhatsApp number, widget visitor), stable across /new
 * - CLI → one local owner
 */
export function sessionOwner(session: Session): string {
  if (session.userId !== undefined) return ownerForUser(session.userId);
  if (session.channel === "cli") return "cli:local";
  if (session.externalId !== undefined) return `${session.channel}:${session.externalId}`;
  return `session:${session.id}`;
}

/** Owner id for a gateway API user. */
export function ownerForUser(userId: string): string {
  return `user:${userId}`;
}
