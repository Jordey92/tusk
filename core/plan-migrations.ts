import type { DatabaseAdapter, Migration } from "../types/migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import { getCorrespondingFilename } from "../utils/filename.js";
import { assertExecutedMigrationChecksums } from "./checksum-validation.js";
import {
  getExecutedMigrationRecordsReadOnly,
  getLastExecutedMigrationFilenamesReadOnly,
} from "./migration-records.js";
import { readMigrations } from "./read-migrations.js";
import { planRollbackMigrations } from "./rollback-plan.js";

export type MigrationPlanDirection = "up" | "down";

export interface MigrationPlanEntry {
  filename: string;
  timestamp: string;
  direction: MigrationPlanDirection;
  sql: string;
  checksum?: string;
  rollbackOf?: string;
}

export interface MigrationPlan {
  direction: MigrationPlanDirection;
  migrations: MigrationPlanEntry[];
  summary: {
    planned: number;
    total: number;
    alreadyExecuted?: number;
    requestedCount?: number;
  };
}

const toUpPlanEntry = (migration: Migration): MigrationPlanEntry => ({
  filename: migration.filename,
  timestamp: migration.timestamp,
  direction: "up",
  sql: migration.sql,
  checksum: calculateChecksum(migration.sql),
});

const toDownPlanEntry = (migration: Migration): MigrationPlanEntry => ({
  filename: migration.filename,
  timestamp: migration.timestamp,
  direction: "down",
  sql: migration.sql,
  rollbackOf: getCorrespondingFilename(migration.filename, "up"),
});

export const createUpPlan = async (
  adapter: DatabaseAdapter,
  migrationsPath: string
): Promise<MigrationPlan> => {
  const migrationsFromDirectory = await readMigrations(migrationsPath, "up");
  const executedMigrations = await getExecutedMigrationRecordsReadOnly(adapter);
  const executedFilenames = new Set(
    executedMigrations.map((migration) => migration.filename)
  );

  assertExecutedMigrationChecksums(migrationsFromDirectory, executedMigrations);

  const migrationsToRun = migrationsFromDirectory.filter(
    (migration) => !executedFilenames.has(migration.filename)
  );

  return {
    direction: "up",
    migrations: migrationsToRun.map(toUpPlanEntry),
    summary: {
      planned: migrationsToRun.length,
      total: migrationsFromDirectory.length,
      alreadyExecuted: executedFilenames.size,
    },
  };
};

export const createDownPlan = async (
  adapter: DatabaseAdapter,
  migrationsPath: string,
  count?: number
): Promise<MigrationPlan> => {
  const migrationsFromDirectory = await readMigrations(migrationsPath, "down");
  const lastExecuted = await getLastExecutedMigrationFilenamesReadOnly(adapter, count);
  const migrationsToRollback = planRollbackMigrations(
    lastExecuted,
    migrationsFromDirectory
  );

  return {
    direction: "down",
    migrations: migrationsToRollback.map(toDownPlanEntry),
    summary: {
      planned: migrationsToRollback.length,
      total: migrationsFromDirectory.length,
      requestedCount: count,
    },
  };
};
