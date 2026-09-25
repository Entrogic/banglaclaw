import { generateApiKey, parseApiKey, verifySecret } from "./keys.js";
import type { ApiKeyRecord, AuthStore, User } from "./types.js";

export interface Principal {
  user: User;
  key: Omit<ApiKeyRecord, "hash">;
}

export interface IssuedKey {
  user: User;
  key: Omit<ApiKeyRecord, "hash">;
  /** Shown once. */
  token: string;
}

const TOUCH_INTERVAL_MS = 60_000;

function publicKey({ hash: _hash, ...rest }: ApiKeyRecord): Omit<ApiKeyRecord, "hash"> {
  return rest;
}

/** Issues and verifies API keys. The application, not the LLM, owns identity. */
export class ApiKeyAuthenticator {
  constructor(readonly store: AuthStore) {}

  /** Creates the user if needed and issues a new key for it. */
  async issueKey(userName: string, keyName = "default"): Promise<IssuedKey> {
    const user = (await this.store.findUserByName(userName)) ?? (await this.store.createUser(userName));
    const generated = generateApiKey();
    const record: ApiKeyRecord = { id: generated.id, userId: user.id, name: keyName, hash: generated.hash, createdAt: new Date() };
    await this.store.saveApiKey(record);
    return { user, key: publicKey(record), token: generated.token };
  }

  /** Resolves a bearer token to its user, or undefined for malformed/unknown/revoked keys. */
  async authenticate(token: string | undefined): Promise<Principal | undefined> {
    if (token === undefined) return undefined;
    const parsed = parseApiKey(token);
    if (parsed === undefined) return undefined;
    const record = await this.store.getApiKey(parsed.id);
    if (record === undefined || record.revokedAt !== undefined || !verifySecret(parsed.secret, record.hash)) return undefined;
    const user = await this.store.getUser(record.userId);
    if (user === undefined) return undefined;

    const now = new Date();
    // Throttle last-used writes so every request doesn't hit the database.
    if (record.lastUsedAt === undefined || now.getTime() - record.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.store.touchApiKey(record.id, now);
      record.lastUsedAt = now;
    }
    return { user, key: publicKey(record) };
  }
}
