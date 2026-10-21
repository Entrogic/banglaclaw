import { asc, eq } from "drizzle-orm";
import { DuplicateDatasetNameError, type EvalDataset, type EvalDatasetStore, type Golden, type NewEvalDataset } from "@entrogic-net/shared";
import type { Database } from "./db.js";
import { isDuplicateName } from "./providers.js";
import { evalDatasets } from "./schema.js";
import { isUuid } from "./sessions.js";

type Row = typeof evalDatasets.$inferSelect;

function toDataset(r: Row): EvalDataset {
  return {
    id: r.id,
    name: r.name,
    ...(r.description !== null && { description: r.description }),
    goldens: r.goldens,
    ...(r.createdBy !== null && { createdBy: r.createdBy }),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PostgresEvalDatasetStore implements EvalDatasetStore {
  constructor(private readonly db: Database) {}

  async list(): Promise<EvalDataset[]> {
    return (await this.db.select().from(evalDatasets).orderBy(asc(evalDatasets.createdAt))).map(toDataset);
  }

  async get(id: string): Promise<EvalDataset | undefined> {
    if (!isUuid(id)) return undefined;
    const [row] = await this.db.select().from(evalDatasets).where(eq(evalDatasets.id, id));
    return row === undefined ? undefined : toDataset(row);
  }

  async create(dataset: NewEvalDataset): Promise<EvalDataset> {
    try {
      const [row] = await this.db
        .insert(evalDatasets)
        .values({ name: dataset.name, description: dataset.description ?? null, goldens: dataset.goldens, createdBy: dataset.createdBy ?? null })
        .returning();
      if (row === undefined) throw new Error("insert returned no row");
      return toDataset(row);
    } catch (error) {
      if (isDuplicateName(error)) throw new DuplicateDatasetNameError(dataset.name);
      throw error;
    }
  }

  async update(id: string, patch: { name?: string; description?: string | null; goldens?: Golden[] }): Promise<EvalDataset | undefined> {
    if (!isUuid(id)) return undefined;
    try {
      const [row] = await this.db
        .update(evalDatasets)
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.goldens !== undefined && { goldens: patch.goldens }),
          updatedAt: new Date(),
        })
        .where(eq(evalDatasets.id, id))
        .returning();
      return row === undefined ? undefined : toDataset(row);
    } catch (error) {
      if (patch.name !== undefined && isDuplicateName(error)) throw new DuplicateDatasetNameError(patch.name);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    return (await this.db.delete(evalDatasets).where(eq(evalDatasets.id, id)).returning({ id: evalDatasets.id })).length > 0;
  }
}
