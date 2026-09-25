import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const API_KEY_PREFIX = "bck";
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TOKEN = /^bck_([0-9a-z]{12})_([0-9A-Za-z]{40})$/;

/** Uniform random base62 string (rejection sampling avoids modulo bias). */
function randomString(length: number, alphabet = ALPHABET): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 256 - (256 % alphabet.length)) out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface GeneratedKey {
  id: string;
  /** Full bearer token — shown once, never stored. */
  token: string;
  hash: string;
}

/**
 * Generates `bck_<12-char id>_<40-char secret>` (~238 bits of secret entropy). High entropy
 * makes a fast SHA-256 hash appropriate; a slow password hash is not needed.
 */
export function generateApiKey(): GeneratedKey {
  const id = randomString(12, ALPHABET.slice(0, 36));
  const secret = randomString(40);
  return { id, token: `${API_KEY_PREFIX}_${id}_${secret}`, hash: hashSecret(secret) };
}

export function parseApiKey(token: string): { id: string; secret: string } | undefined {
  const match = TOKEN.exec(token.trim());
  return match === null ? undefined : { id: match[1] as string, secret: match[2] as string };
}

export function verifySecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
