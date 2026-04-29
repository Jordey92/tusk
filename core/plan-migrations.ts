import type { DatabaseAdapter, Migration } from "../types/migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import { getCorrespondingFilename } from "../utils/filename.js";
import {
  resolveDownMigrationState,
  resolveUpMigrationState,
} from "./migration-resolution.js";
import type { RollbackTarget } from "./rollback-target.js";

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
    availableRollbackCount?: number;
    rollbackAll?: boolean;
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
  const migrationState = await resolveUpMigrationState(adapter, migrationsPath);

  return {
    direction: "up",
    migrations: migrationState.pendingMigrations.map(toUpPlanEntry),
    summary: {
      planned: migrationState.pendingMigrations.length,
      total: migrationState.migrationsFromDirectory.length,
      alreadyExecuted: migrationState.executedFilenames.size,
    },
  };
};

export const createDownPlan = async (
  adapter: DatabaseAdapter,
  migrationsPath: string,
  target?: RollbackTarget
): Promise<MigrationPlan> => {
  const migrationState = await resolveDownMigrationState(
    adapter,
    migrationsPath,
    target
  );

  return {
    direction: "down",
    migrations: migrationState.rollbackMigrations.map(toDownPlanEntry),
    summary: {
      planned: migrationState.rollbackMigrations.length,
      total: migrationState.migrationsFromDirectory.length,
      requestedCount: migrationState.requestedCount,
      availableRollbackCount: migrationState.availableRollbackCount,
      rollbackAll: migrationState.rollbackTarget.mode === "all",
    },
  };
};
