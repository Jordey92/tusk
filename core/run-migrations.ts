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
  isTuskError,
  type TuskError,
  toError,
} from "../utils/errors.js";
import { calculateChecksum } from "../utils/checksum.js";
import { normalizeRollbackTarget, type RollbackTarget } from "./rollback-target.js";
import {
  ensureMigrationsTable,
  markAsExecuted,
  markAsRolledBack,
} from "./track-migrations.js";
import {
  resolveDownMigrationState,
  resolveUpMigrationState,
} from "./migration-resolution.js";

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
      if (isTuskError(error)) {
        throw error;
      }

      const tuskError = createDatabaseError(
        "Failed to ensure migrations table exists. Check database connection.",
        toError(error)
      );
      logger.error("Database connection failed", { error: formatTuskError(tuskError) });
      throw tuskError;
    }

    const migrationState = await resolveUpMigrationState(adapter, migrationsPath);

    logger.debug("Migration checksums verified");

    logger.info("Found migrations to execute", {
      total: migrationState.migrationsFromDirectory.length,
      toExecute: migrationState.pendingMigrations.length,
      alreadyExecuted: migrationState.executedFilenames.size,
    });

    const pending = await executeMigrationBatch({
      adapter,
      migrations: migrationState.pendingMigrations,
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
      executed: migrationState.pendingMigrations.length,
    });
    return { executed: migrationState.pendingMigrations.length, pending };
  } finally {
    await adapter.releaseMigrationLock();
  }
};

export const runDown = async (
  adapter: DatabaseAdapter,
  migrationsPath: string,
  target?: RollbackTarget
): Promise<RunResult> => {
  logger.info("Starting migration down process", {
    migrationsPath,
  });

  await adapter.acquireMigrationLock();

  try {
    await ensureMigrationsTable(adapter);
    const migrationState = await resolveDownMigrationState(
      adapter,
      migrationsPath,
      target
    );

    logger.info("Found migrations to rollback", {
      total: migrationState.migrationsFromDirectory.length,
      toRollback: migrationState.rollbackMigrations.length,
      rollbackMode: migrationState.rollbackTarget.mode,
      requestedCount: migrationState.requestedCount,
    });

    const pending = await executeMigrationBatch({
      adapter,
      migrations: migrationState.rollbackMigrations,
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
      executed: migrationState.rollbackMigrations.length,
    });
    return {
      executed: migrationState.rollbackMigrations.length,
      pending,
      requestedCount: migrationState.requestedCount,
      availableRollbackCount: migrationState.availableRollbackCount,
      rollbackAll: migrationState.rollbackTarget.mode === "all",
    };
  } finally {
    await adapter.releaseMigrationLock();
  }
};
