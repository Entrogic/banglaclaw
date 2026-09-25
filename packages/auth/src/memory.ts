import { randomUUID } from "node:crypto";
import type { ApiKeyRecord, AuthStore, User } from "./types.js";

/** Process-local users and API keys (storage.provider: memory). */
export class InMemoryAuthStore implements AuthStore {
  readonly #users = new Map<string, User>();
  readonly #keys = new Map<string, ApiKeyRecord>();

  async createUser(name: string): Promise<User> {
    if ((await this.findUserByName(name)) !== undefined) throw new Error(`User "${name}" already exists`);
    const user: User = { id: randomUUID(), name, createdAt: new Date() };
    this.#users.set(user.id, user);
    return { ...user };
  }

  async getUser(id: string): Promise<User | undefined> {
    const u = this.#users.get(id);
    return u === undefined ? undefined : { ...u };
  }

  async findUserByName(name: string): Promise<User | undefined> {
    for (const u of this.#users.values()) if (u.name === name) return { ...u };
    return undefined;
  }

  async listUsers(): Promise<User[]> {
    return [...this.#users.values()].map((u) => ({ ...u }));
  }

  async saveApiKey(record: ApiKeyRecord): Promise<void> {
    if (!this.#users.has(record.userId)) throw new Error(`Unknown user ${record.userId}`);
    this.#keys.set(record.id, { ...record });
  }

  async getApiKey(id: string): Promise<ApiKeyRecord | undefined> {
    const k = this.#keys.get(id);
    return k === undefined ? undefined : { ...k };
  }

  async listApiKeys(options: { userId?: string } = {}): Promise<ApiKeyRecord[]> {
    return [...this.#keys.values()]
      .filter((k) => options.userId === undefined || k.userId === options.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((k) => ({ ...k }));
  }

  async revokeApiKey(id: string, at = new Date()): Promise<boolean> {
    const k = this.#keys.get(id);
    if (k === undefined || k.revokedAt !== undefined) return false;
    k.revokedAt = at;
    return true;
  }

  async touchApiKey(id: string, at: Date): Promise<void> {
    const k = this.#keys.get(id);
    if (k !== undefined) k.lastUsedAt = at;
  }
}
