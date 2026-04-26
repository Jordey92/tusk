import type { DatabaseAdapter } from "../types/migrations.js";
import type { MigrationStatusPayload } from "../types/cli.js";
import { readMigrations } from "./read-migrations.js";
import {
  ensureMigrationsTable,
  getExecutedMigrationsWithChecksums,
} from "./track-migrations.js";

export const getMigrationStatus = async (
  adapter: DatabaseAdapter,
  migrationsPath: string
): Promise<MigrationStatusPayload> => {
  await ensureMigrationsTable(adapter);

  const allMigrations = await readMigrations(migrationsPath, "up");
  const executedMigrations = await getExecutedMigrationsWithChecksums(adapter);
  const executedFilenames = new Set(
    executedMigrations.map((migration) => migration.filename)
  );
  const executed = allMigrations.filter((migration) =>
    executedFilenames.has(migration.filename)
  );
  const pending = allMigrations.filter(
    (migration) => !executedFilenames.has(migration.filename)
  );

  return {
    executed: executed.map((migration) => {
      const record = executedMigrations.find(
        (executedMigration) => executedMigration.filename === migration.filename
      );

      return {
        filename: migration.filename,
        executedAt: record?.executed_at
          ? new Date(record.executed_at).toISOString()
          : null,
      };
    }),
    pending: pending.map((migration) => ({
      filename: migration.filename,
    })),
    summary: {
      executed: executed.length,
      pending: pending.length,
    },
  };
};
