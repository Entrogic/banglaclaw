export interface User {
  id: string;
  /** Unique, human-readable handle (e.g. "shop-bot", "rahim"). */
  name: string;
  createdAt: Date;
}

/** Stored API key. The secret itself is never stored — only its SHA-256 hash. */
export interface ApiKeyRecord {
  /** Public identifier embedded in the token (bck_<id>_<secret>). */
  id: string;
  userId: string;
  name: string;
  hash: string;
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

export interface AuthStore {
  createUser(name: string): Promise<User>;
  getUser(id: string): Promise<User | undefined>;
  findUserByName(name: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  saveApiKey(record: ApiKeyRecord): Promise<void>;
  getApiKey(id: string): Promise<ApiKeyRecord | undefined>;
  listApiKeys(options?: { userId?: string }): Promise<ApiKeyRecord[]>;
  /** Returns false if the key does not exist or was already revoked. */
  revokeApiKey(id: string, at?: Date): Promise<boolean>;
  touchApiKey(id: string, at: Date): Promise<void>;
}
