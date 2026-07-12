import type {
  MigrationAdapter,
  DownRunResult,
  Migration,
  TransactionClient,
  UpRunResult,
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
  toRollbackTargetPayload,
} from "./migration-resolution.js";
import {
  assertMigrationBatchExecutable,
  assertMigrationDirectoryExecutable,
} from "./validate-migrations.js";
import { withMigrationLock } from "./migration-lock.js";

interface MigrationBatchOptions {
  adapter: MigrationAdapter;
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
  adapter: MigrationAdapter,
  migrationsPath: string
): Promise<UpRunResult> => {
  logger.info("Starting migration up process", { migrationsPath });

  return withMigrationLock(adapter, "up", async () => {
    await assertMigrationDirectoryExecutable(migrationsPath);
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
    assertMigrationBatchExecutable(migrationState.pendingMigrations);

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
  });
};

export const runDown = async (
  adapter: MigrationAdapter,
  migrationsPath: string,
  target?: RollbackTarget
): Promise<DownRunResult> => {
  logger.info("Starting migration down process", {
    migrationsPath,
  });

  return withMigrationLock(adapter, "down", async () => {
    await ensureMigrationsTable(adapter);
    const migrationState = await resolveDownMigrationState(
      adapter,
      migrationsPath,
      target
    );
    assertMigrationBatchExecutable(migrationState.rollbackMigrations);

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
      rollbackTarget: toRollbackTargetPayload(migrationState),
    };
  });
};
