import type {
  DatabaseAdapter,
  Migration,
  RunResult,
  TransactionClient,
} from "../types/migrations.js";
import type { StructuredContext } from "../types/structured.js";
import { getCorrespondingFilename } from "../utils/filename.js";
import { logger } from "../utils/logger.js";
import {
  createDatabaseError,
  createMigrationExecutionError,
  createRollbackError,
  formatTuskError,
  type TuskError,
  toError,
} from "../utils/errors.js";
import { readMigrations } from "./read-migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import { planRollbackMigrations } from "./rollback-plan.js";
import { normalizeRollbackTarget, type RollbackTarget } from "./rollback-target.js";
import { assertExecutedMigrationChecksums } from "./checksum-validation.js";
import {
  ensureMigrationsTable,
  getLastExecutedMigrations,
  getExecutedMigrationsWithChecksums,
  markAsExecuted,
  markAsRolledBack,
} from "./track-migrations.js";

interface MigrationBatchOptions {
  adapter: DatabaseAdapter;
  migrations: Migration[];
  debugMessage: string;
  successMessage: string;
  failureMessage: string;
  execute: (
    client: TransactionClient,
    migration: Migration
  ) => Promise<StructuredContext>;
  createFailure: (filename: string, cause: Error) => TuskError;
}

const executeMigrationBatch = async ({
  adapter,
  migrations,
  debugMessage,
  successMessage,
  failureMessage,
  execute,
  createFailure,
}: MigrationBatchOptions): Promise<number> => {
  let pending = migrations.length;

  for (const migration of migrations) {
    logger.debug(debugMessage, { filename: migration.filename });

    try {
      await adapter.transaction(async (client) => {
        const context = await execute(client, migration);
        pending--;
        logger.info(successMessage, context);
      });
    } catch (error) {
      const tuskError = createFailure(migration.filename, toError(error));
      logger.error(failureMessage, {
        filename: migration.filename,
        error: formatTuskError(tuskError),
      });
      throw tuskError;
    }
  }

  return pending;
};

export const runUp = async (
  adapter: DatabaseAdapter,
  migrationsPath: string
): Promise<RunResult> => {
  logger.info("Starting migration up process", { migrationsPath });

  await adapter.acquireMigrationLock();

  try {
    try {
      await ensureMigrationsTable(adapter);
      logger.debug("Migrations table ensured");
    } catch (error) {
      const tuskError = createDatabaseError(
        "Failed to ensure migrations table exists. Check database connection.",
        toError(error)
      );
      logger.error("Database connection failed", { error: formatTuskError(tuskError) });
      throw tuskError;
    }

    const migrationsFromDirectory = await readMigrations(migrationsPath, "up");

    const executedMigrations = await getExecutedMigrationsWithChecksums(adapter);
    const executedFilenames = new Set(
      executedMigrations.map((migration) => migration.filename)
    );

    assertExecutedMigrationChecksums(migrationsFromDirectory, executedMigrations);

    logger.debug("Migration checksums verified");

    const migrationsToRun = migrationsFromDirectory.filter(
      (migration) => !executedFilenames.has(migration.filename)
    );

    logger.info("Found migrations to execute", {
      total: migrationsFromDirectory.length,
      toExecute: migrationsToRun.length,
      alreadyExecuted: executedFilenames.size,
    });

    const pending = await executeMigrationBatch({
      adapter,
      migrations: migrationsToRun,
      debugMessage: "Executing migration",
      successMessage: "Migration executed successfully",
      failureMessage: "Migration execution failed",
      execute: async (client, migration) => {
        const checksum = calculateChecksum(migration.sql);
        await client.query(migration.sql);
        await markAsExecuted(client, migration.filename, checksum);

        return {
          filename: migration.filename,
          checksum,
        };
      },
      createFailure: (filename, cause) =>
        createMigrationExecutionError(filename, cause),
    });

    logger.info("Migration up process completed", {
      executed: migrationsToRun.length,
    });
    return { executed: migrationsToRun.length, pending };
  } finally {
    await adapter.releaseMigrationLock();
  }
};

export const runDown = async (
  adapter: DatabaseAdapter,
  migrationsPath: string,
  target?: RollbackTarget
): Promise<RunResult> => {
  const rollbackTarget = normalizeRollbackTarget(target);
  const count = rollbackTarget.mode === "count"
    ? rollbackTarget.count
    : undefined;

  logger.info("Starting migration down process", {
    migrationsPath,
    count,
    all: rollbackTarget.mode === "all",
  });

  await adapter.acquireMigrationLock();

  try {
    await ensureMigrationsTable(adapter);
    const migrationsFromDirectory = await readMigrations(migrationsPath, "down");

    const lastExecuted = await getLastExecutedMigrations(adapter, count);
    const migrationsToRollback = planRollbackMigrations(
      lastExecuted,
      migrationsFromDirectory
    );

    logger.info("Found migrations to rollback", {
      total: migrationsFromDirectory.length,
      toRollback: migrationsToRollback.length,
      requestedCount: count,
      all: rollbackTarget.mode === "all",
    });

    const pending = await executeMigrationBatch({
      adapter,
      migrations: migrationsToRollback,
      debugMessage: "Rolling back migration",
      successMessage: "Migration rolled back successfully",
      failureMessage: "Migration rollback failed",
      execute: async (client, migration) => {
        await client.query(migration.sql);
        const upFilename = getCorrespondingFilename(migration.filename, "up");
        await markAsRolledBack(client, upFilename);

        return { filename: migration.filename };
      },
      createFailure: (filename, cause) => createRollbackError(filename, cause),
    });

    logger.info("Migration down process completed", {
      executed: migrationsToRollback.length,
    });
    return {
      executed: migrationsToRollback.length,
      pending,
      requestedCount: rollbackTarget.mode === "count"
        ? rollbackTarget.requestedCount
        : undefined,
      availableRollbackCount: lastExecuted.length,
      rollbackAll: rollbackTarget.mode === "all",
    };
  } finally {
    await adapter.releaseMigrationLock();
  }
};
