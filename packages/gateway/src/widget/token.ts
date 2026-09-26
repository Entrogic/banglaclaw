import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface VisitorToken {
  visitorId: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

/**
 * Anonymous widget visitors carry `v1.<visitorId>.<exp>.<hmac>`: a random id signed with the
 * gateway's widget secret. Nothing is stored server-side; the id keys the visitor's session.
 */
export class VisitorTokens {
  readonly #secret: Buffer;

  constructor(
    secret: string,
    readonly ttlSeconds: number,
    readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.#secret = Buffer.from(secret, "utf8");
  }

  issue(visitorId: string = randomUUID()): { token: string; visitor: VisitorToken } {
    const visitor = { visitorId, exp: this.now() + this.ttlSeconds };
    const payload = `${VERSION}.${visitor.visitorId}.${visitor.exp}`;
    return { token: `${payload}.${this.#sign(payload)}`, visitor };
  }

  /** The visitor for a valid, unexpired token; undefined for anything else. */
  verify(token: string | undefined): VisitorToken | undefined {
    if (token === undefined || token.length > 200) return undefined;
    const parts = token.split(".");
    if (parts.length !== 4) return undefined;
    const [version, visitorId, expText, signature] = parts as [string, string, string, string];
    if (version !== VERSION || !UUID.test(visitorId) || !/^\d{1,12}$/.test(expText)) return undefined;
    const expected = Buffer.from(this.#sign(`${version}.${visitorId}.${expText}`));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    const exp = Number(expText);
    return exp > this.now() ? { visitorId, exp } : undefined;
  }

  #sign(payload: string): string {
    return createHmac("sha256", this.#secret).update(payload).digest("base64url");
  }
}
