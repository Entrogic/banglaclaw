import { asc, eq } from "drizzle-orm";
import { DuplicateProviderNameError, type NewProviderProfile, type ProviderProfile, type ProviderProfilePatch, type ProviderStore } from "@entrogic-net/shared";
import type { Database } from "./db.js";
import { modelProviders } from "./schema.js";
import { isUuid } from "./sessions.js";

type Row = typeof modelProviders.$inferSelect;

function toProfile(r: Row): ProviderProfile {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    ...(r.baseUrl !== null && { baseUrl: r.baseUrl }),
    ...(r.temperature !== null && { temperature: r.temperature }),
    ...(r.apiKeyCiphertext !== null && { apiKeyCiphertext: r.apiKeyCiphertext }),
    ...(r.apiKeyHint !== null && { apiKeyHint: r.apiKeyHint }),
    active: r.active,
    ...(r.createdBy !== null && { createdBy: r.createdBy }),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Postgres unique_violation on the name column. */
function isDuplicateName(error: unknown): boolean {
  const cause = error instanceof Error && "cause" in error ? error.cause : error;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505" && "constraint" in cause && String(cause.constraint).includes("name");
}

export class PostgresProviderStore implements ProviderStore {
  constructor(private readonly db: Database) {}

  async list(): Promise<ProviderProfile[]> {
    return (await this.db.select().from(modelProviders).orderBy(asc(modelProviders.createdAt))).map(toProfile);
  }

  async get(id: string): Promise<ProviderProfile | undefined> {
    if (!isUuid(id)) return undefined;
    const [row] = await this.db.select().from(modelProviders).where(eq(modelProviders.id, id));
    return row === undefined ? undefined : toProfile(row);
  }

  async create(profile: NewProviderProfile): Promise<ProviderProfile> {
    try {
      const [row] = await this.db
        .insert(modelProviders)
        .values({
          id: profile.id,
          name: profile.name,
          provider: profile.provider,
          model: profile.model,
          baseUrl: profile.baseUrl ?? null,
          temperature: profile.temperature ?? null,
          apiKeyCiphertext: profile.apiKeyCiphertext ?? null,
          apiKeyHint: profile.apiKeyHint ?? null,
          createdBy: profile.createdBy ?? null,
        })
        .returning();
      if (row === undefined) throw new Error("insert returned no row");
      return toProfile(row);
    } catch (error) {
      if (isDuplicateName(error)) throw new DuplicateProviderNameError(profile.name);
      throw error;
    }
  }

  async update(id: string, patch: ProviderProfilePatch): Promise<ProviderProfile | undefined> {
    if (!isUuid(id)) return undefined;
    try {
      const [row] = await this.db
        .update(modelProviders)
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.model !== undefined && { model: patch.model }),
          ...(patch.baseUrl !== undefined && { baseUrl: patch.baseUrl }),
          ...(patch.temperature !== undefined && { temperature: patch.temperature }),
          ...(patch.apiKeyCiphertext !== undefined && { apiKeyCiphertext: patch.apiKeyCiphertext }),
          ...(patch.apiKeyHint !== undefined && { apiKeyHint: patch.apiKeyHint }),
          updatedAt: new Date(),
        })
        .where(eq(modelProviders.id, id))
        .returning();
      return row === undefined ? undefined : toProfile(row);
    } catch (error) {
      if (patch.name !== undefined && isDuplicateName(error)) throw new DuplicateProviderNameError(patch.name);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    return (await this.db.delete(modelProviders).where(eq(modelProviders.id, id)).returning({ id: modelProviders.id })).length > 0;
  }

  async active(): Promise<ProviderProfile | undefined> {
    const [row] = await this.db.select().from(modelProviders).where(eq(modelProviders.active, true));
    return row === undefined ? undefined : toProfile(row);
  }

  async setActive(id: string | undefined): Promise<boolean> {
    if (id !== undefined && !isUuid(id)) return false;
    return this.db.transaction(async (tx) => {
      if (id !== undefined) {
        const [found] = await tx.select({ id: modelProviders.id }).from(modelProviders).where(eq(modelProviders.id, id)).for("update");
        if (found === undefined) return false;
      }
      // Deactivate first: the partial unique index allows only one active row at a time.
      await tx.update(modelProviders).set({ active: false }).where(eq(modelProviders.active, true));
      if (id !== undefined) await tx.update(modelProviders).set({ active: true }).where(eq(modelProviders.id, id));
      return true;
    });
  }
}
