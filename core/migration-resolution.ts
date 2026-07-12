import type {
  MigrationAdapter,
  Migration,
  MigrationRecord,
  RollbackTargetPayload,
} from "../types/migrations.js";
import { assertExecutedMigrationChecksums } from "./checksum-validation.js";
import {
  getExecutedMigrationCountReadOnly,
  getExecutedMigrationRecordsReadOnly,
  getLastExecutedMigrationFilenamesReadOnly,
} from "./migration-records.js";
import { readMigrations } from "./read-migrations.js";
import { planRollbackMigrations } from "./rollback-plan.js";
import { assertBaselineRollbackAllowed } from "./baseline.js";
import {
  normalizeRollbackTarget,
  type NormalizedRollbackTarget,
  type RollbackTarget,
} from "./rollback-target.js";

export interface UpMigrationState {
  migrationsFromDirectory: Migration[];
  executedMigrations: MigrationRecord[];
  executedFilenames: Set<string>;
  executedLocalMigrations: Migration[];
  pendingMigrations: Migration[];
}

export interface DownMigrationState {
  rollbackTarget: NormalizedRollbackTarget;
  requestedCount?: number;
  availableRollbackCount: number;
  migrationsFromDirectory: Migration[];
  lastExecutedFilenames: string[];
  rollbackMigrations: Migration[];
}

export const toRollbackTargetPayload = (
  state: Pick<DownMigrationState, "availableRollbackCount" | "rollbackTarget">
): RollbackTargetPayload => {
  if (state.rollbackTarget.mode === "all") {
    return {
      mode: "all",
      availableRollbackCount: state.availableRollbackCount,
    };
  }

  return {
    mode: "count",
    requestedCount: state.rollbackTarget.requestedCount,
    availableRollbackCount: state.availableRollbackCount,
  };
};

export const readUpMigrationState = async (
  adapter: MigrationAdapter,
  migrationsPath: string
): Promise<UpMigrationState> => {
  const migrationsFromDirectory = await readMigrations(migrationsPath, "up");
  const executedMigrations = await getExecutedMigrationRecordsReadOnly(adapter);
  const executedFilenames = new Set(
    executedMigrations.map((migration) => migration.filename)
  );
  const executedLocalMigrations = migrationsFromDirectory.filter((migration) =>
    executedFilenames.has(migration.filename)
  );
  const pendingMigrations = migrationsFromDirectory.filter(
    (migration) => !executedFilenames.has(migration.filename)
  );

  return {
    migrationsFromDirectory,
    executedMigrations,
    executedFilenames,
    executedLocalMigrations,
    pendingMigrations,
  };
};

export const resolveUpMigrationState = async (
  adapter: MigrationAdapter,
  migrationsPath: string
): Promise<UpMigrationState> => {
  const state = await readUpMigrationState(adapter, migrationsPath);
  assertExecutedMigrationChecksums(
    state.migrationsFromDirectory,
    state.executedMigrations
  );
  return state;
};

export const resolveDownMigrationState = async (
  adapter: MigrationAdapter,
  migrationsPath: string,
  target?: RollbackTarget
): Promise<DownMigrationState> => {
  const rollbackTarget = normalizeRollbackTarget(target);
  const count = rollbackTarget.mode === "count"
    ? rollbackTarget.count
    : undefined;
  const migrationsFromDirectory = await readMigrations(migrationsPath, "down");
  const availableRollbackCount = await getExecutedMigrationCountReadOnly(adapter);
  const lastExecutedFilenames = await getLastExecutedMigrationFilenamesReadOnly(
    adapter,
    count
  );
  assertBaselineRollbackAllowed(lastExecutedFilenames, rollbackTarget);
  const rollbackMigrations = planRollbackMigrations(
    lastExecutedFilenames,
    migrationsFromDirectory
  );

  return {
    rollbackTarget,
    requestedCount: rollbackTarget.mode === "count"
      ? rollbackTarget.requestedCount
      : undefined,
    availableRollbackCount,
    migrationsFromDirectory,
    lastExecutedFilenames,
    rollbackMigrations,
  };
};
