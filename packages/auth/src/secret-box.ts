import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { ConfigError } from "@entrogic-net/shared";

const VERSION = "v1";
const INFO = "banglaclaw secret-box v1";
export const MIN_SECRET_KEY_LENGTH = 32;

/**
 * AES-256-GCM for secrets stored at rest, such as provider API keys (ADR-0019). The key is derived
 * from BANGLACLAW_SECRET_KEY with HKDF-SHA256. `aad` binds a ciphertext to its row (the profile id),
 * so a ciphertext copied to another row does not decrypt. Format: `v1:<iv>:<tag>:<data>` (base64url).
 */
export class SecretBox {
  readonly #key: Buffer;

  constructor(secret: string) {
    if (secret.length < MIN_SECRET_KEY_LENGTH) {
      throw new ConfigError(`BANGLACLAW_SECRET_KEY must be at least ${MIN_SECRET_KEY_LENGTH} characters (try \`openssl rand -base64 32\`)`);
    }
    this.#key = Buffer.from(hkdfSync("sha256", secret, "", INFO, 32));
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
  }

  /** Throws when the ciphertext was made with another key, for another row, or was tampered with. */
  decrypt(ciphertext: string, aad: string): string {
    const [version, iv, tag, data] = ciphertext.split(":");
    if (version !== VERSION || iv === undefined || tag === undefined || data === undefined) throw new Error("Unrecognised ciphertext format");
    const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }
}
