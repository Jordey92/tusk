import type { DatabaseAdapter } from "../types/migrations.js";
import type { MigrationStatusPayload } from "../types/cli.js";
import { readUpMigrationState } from "./migration-resolution.js";
import { ensureMigrationsTable } from "./track-migrations.js";

export const getMigrationStatus = async (
  adapter: DatabaseAdapter,
  migrationsPath: string
): Promise<MigrationStatusPayload> => {
  await ensureMigrationsTable(adapter);

  const migrationState = await readUpMigrationState(adapter, migrationsPath);

  return {
    executed: migrationState.executedLocalMigrations.map((migration) => {
      const record = migrationState.executedMigrations.find(
        (executedMigration) => executedMigration.filename === migration.filename
      );

      return {
        filename: migration.filename,
        executedAt: record?.executed_at
          ? new Date(record.executed_at).toISOString()
          : null,
      };
    }),
    pending: migrationState.pendingMigrations.map((migration) => ({
      filename: migration.filename,
    })),
    summary: {
      executed: migrationState.executedLocalMigrations.length,
      pending: migrationState.pendingMigrations.length,
    },
  };
};
