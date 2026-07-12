import type {
  MigrationAdapter,
  Migration,
  RollbackTargetPayload,
} from "../types/migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import { getCorrespondingFilename } from "../utils/filename.js";
import {
  resolveDownMigrationState,
  resolveUpMigrationState,
  toRollbackTargetPayload,
} from "./migration-resolution.js";
import type { RollbackTarget } from "./rollback-target.js";
import {
  assertMigrationBatchExecutable,
  assertMigrationDirectoryExecutable,
} from "./validate-migrations.js";

export type MigrationPlanDirection = "up" | "down";

interface BaseMigrationPlanEntry {
  filename: string;
  timestamp: string;
  sql: string;
}

export interface UpMigrationPlanEntry extends BaseMigrationPlanEntry {
  direction: "up";
  checksum: string;
}

export interface DownMigrationPlanEntry extends BaseMigrationPlanEntry {
  direction: "down";
  rollbackOf: string;
}

export type MigrationPlanEntry = UpMigrationPlanEntry | DownMigrationPlanEntry;

export interface UpMigrationPlan {
  direction: "up";
  migrations: UpMigrationPlanEntry[];
  summary: {
    planned: number;
    total: number;
    alreadyExecuted: number;
    rollbackTarget?: never;
  };
}

export interface DownMigrationPlan {
  direction: "down";
  migrations: DownMigrationPlanEntry[];
  summary: {
    planned: number;
    total: number;
    alreadyExecuted?: never;
    rollbackTarget: RollbackTargetPayload;
  };
}

export type MigrationPlan = UpMigrationPlan | DownMigrationPlan;

const toUpPlanEntry = (migration: Migration): UpMigrationPlanEntry => ({
  filename: migration.filename,
  timestamp: migration.timestamp,
  direction: "up",
  sql: migration.sql,
  checksum: calculateChecksum(migration.sql),
});

const toDownPlanEntry = (migration: Migration): DownMigrationPlanEntry => ({
  filename: migration.filename,
  timestamp: migration.timestamp,
  direction: "down",
  sql: migration.sql,
  rollbackOf: getCorrespondingFilename(migration.filename, "up"),
});

export const createUpPlan = async (
  adapter: MigrationAdapter,
  migrationsPath: string
): Promise<UpMigrationPlan> => {
  await assertMigrationDirectoryExecutable(migrationsPath);
  const migrationState = await resolveUpMigrationState(adapter, migrationsPath);
  assertMigrationBatchExecutable(migrationState.pendingMigrations);

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
  adapter: MigrationAdapter,
  migrationsPath: string,
  target?: RollbackTarget
): Promise<DownMigrationPlan> => {
  const migrationState = await resolveDownMigrationState(
    adapter,
    migrationsPath,
    target
  );
  assertMigrationBatchExecutable(migrationState.rollbackMigrations);

  return {
    direction: "down",
    migrations: migrationState.rollbackMigrations.map(toDownPlanEntry),
    summary: {
      planned: migrationState.rollbackMigrations.length,
      total: migrationState.migrationsFromDirectory.length,
      rollbackTarget: toRollbackTargetPayload(migrationState),
    },
  };
};
