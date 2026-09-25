import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { ApiKeyRecord, AuthStore, User } from "@banglaclaw/auth";
import type { Database } from "./db.js";
import { apiKeys, users } from "./schema.js";

type KeyRow = typeof apiKeys.$inferSelect;

function toKey(row: KeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    hash: row.hash,
    createdAt: row.createdAt,
    ...(row.lastUsedAt !== null && { lastUsedAt: row.lastUsedAt }),
    ...(row.revokedAt !== null && { revokedAt: row.revokedAt }),
  };
}

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly db: Database) {}

  async createUser(name: string): Promise<User> {
    const [row] = await this.db.insert(users).values({ name }).returning();
    if (row === undefined) throw new Error("User insert returned no row");
    return row;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row;
  }

  async findUserByName(name: string): Promise<User | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.name, name));
    return row;
  }

  async listUsers(): Promise<User[]> {
    return this.db.select().from(users).orderBy(asc(users.name));
  }

  async saveApiKey(record: ApiKeyRecord): Promise<void> {
    await this.db.insert(apiKeys).values({
      id: record.id,
      userId: record.userId,
      name: record.name,
      hash: record.hash,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt ?? null,
      revokedAt: record.revokedAt ?? null,
    });
  }

  async getApiKey(id: string): Promise<ApiKeyRecord | undefined> {
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id));
    return row === undefined ? undefined : toKey(row);
  }

  async listApiKeys(options: { userId?: string } = {}): Promise<ApiKeyRecord[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(options.userId !== undefined ? eq(apiKeys.userId, options.userId) : undefined)
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(toKey);
  }

  async revokeApiKey(id: string, at = new Date()): Promise<boolean> {
    const updated = await this.db
      .update(apiKeys)
      .set({ revokedAt: at })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    return updated.length > 0;
  }

  async touchApiKey(id: string, at: Date): Promise<void> {
    await this.db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
  }
}
