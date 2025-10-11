import type { DatabaseAdapter, RunResult } from "../types/migrations.js";
import { getCorrespondingFilename } from "../utils/filename.js";
import { logger } from "../utils/logger.js";
import { createDatabaseError, createMigrationExecutionError, createRollbackError, formatTuskError, createValidationError } from "../utils/errors.js";
import { readMigrations } from "./read-migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import {
  ensureMigrationsTable,
  getLastExecutedMigrations,
  getExecutedMigrationsWithChecksums,
  markAsExecuted,
  markAsRolledBack,
} from "./track-migrations.js";

export const runUp = async (
  adapter: DatabaseAdapter,
  migrationsPath: string
): Promise<RunResult> => {
  logger.info("Starting migration up process", { migrationsPath });

  // Acquire migration lock to prevent concurrent migrations
  await adapter.acquireMigrationLock();

  try {
    await ensureMigrationsTable(adapter);
    logger.debug("Migrations table ensured");
  } catch (error) {
    await adapter.releaseMigrationLock();
    const tuskError = createDatabaseError(
      "Failed to ensure migrations table exists. Check database connection.",
      error instanceof Error ? error : new Error(String(error))
    );
    logger.error("Database connection failed", { error: formatTuskError(tuskError) });
    throw new Error(formatTuskError(tuskError));
  }

  try {
    // Read all migrations from directory
    const migrationsFromDirectory = await readMigrations(migrationsPath, "up");

    // Get executed migrations with checksums
    const executedMigrations = await getExecutedMigrationsWithChecksums(adapter);
    const executedFilenames = new Set(executedMigrations.map(m => m.filename));

    // Verify checksums of already-executed migrations
    for (const executedMigration of executedMigrations) {
      if (!executedMigration.checksum) {
        // Migration executed before checksums were added, skip verification
        continue;
      }

      const migrationFile = migrationsFromDirectory.find(
        m => m.filename === executedMigration.filename
      );

      if (migrationFile) {
        const currentChecksum = calculateChecksum(migrationFile.sql);
        if (currentChecksum !== executedMigration.checksum) {
          await adapter.releaseMigrationLock();
          const tuskError = createValidationError(
            `Migration file ${executedMigration.filename} has been modified after execution. ` +
            `This is not allowed. Original checksum: ${executedMigration.checksum}, ` +
            `current checksum: ${currentChecksum}`,
            { filename: executedMigration.filename }
          );
          logger.error("Migration checksum mismatch", { error: formatTuskError(tuskError) });
          throw new Error(formatTuskError(tuskError));
        }
      }
    }

    logger.debug("Migration checksums verified");

    // Find migrations that haven't been executed yet
    const migrationsToRun = migrationsFromDirectory.filter(
      (migration) =>
        !executedFilenames.has(migration.filename) &&
        migration.filename.endsWith(".up.sql")
    );

    logger.info("Found migrations to execute", {
      total: migrationsFromDirectory.length,
      toExecute: migrationsToRun.length,
      alreadyExecuted: executedFilenames.size
    });

    let pending = migrationsToRun.length;

    // Execute pending migrations
    for (const migration of migrationsToRun) {
      logger.debug("Executing migration", { filename: migration.filename });

      try {
        const checksum = calculateChecksum(migration.sql);

        await adapter.transaction(async (client) => {
          await client.query(migration.sql);
          await markAsExecuted(client, migration.filename, checksum);
          pending--;
          logger.info("Migration executed successfully", {
            filename: migration.filename,
            checksum
          });
        });
      } catch (error) {
        const tuskError = createMigrationExecutionError(
          migration.filename,
          error instanceof Error ? error : new Error(String(error))
        );
        logger.error("Migration execution failed", {
          filename: migration.filename,
          error: formatTuskError(tuskError)
        });
        throw new Error(formatTuskError(tuskError));
      }
    }

    logger.info("Migration up process completed", { executed: migrationsToRun.length });
    return { executed: migrationsToRun.length, pending };
  } finally {
    // Always release the lock, even if an error occurred
    await adapter.releaseMigrationLock();
  }
};

export const runDown = async (
  adapter: DatabaseAdapter,
  migrationsPath: string,
  count?: number
): Promise<RunResult> => {
  logger.info("Starting migration down process", { migrationsPath, count });

  // Acquire migration lock to prevent concurrent migrations
  await adapter.acquireMigrationLock();

  try {
    await ensureMigrationsTable(adapter);
    const migrationsFromDirectory = await readMigrations(migrationsPath, "down");

    const lastExecuted = await getLastExecutedMigrations(adapter, count);
    const lastExecutedSet = new Set(lastExecuted);

    const migrationsToRollback = migrationsFromDirectory.filter((migration) => {
      const upFilename = getCorrespondingFilename(migration.filename, "up");
      return lastExecutedSet.has(upFilename);
    });

    logger.info("Found migrations to rollback", {
      total: migrationsFromDirectory.length,
      toRollback: migrationsToRollback.length,
      requestedCount: count
    });

    let pending = migrationsToRollback.length;

    for (const migration of migrationsToRollback) {
      logger.debug("Rolling back migration", { filename: migration.filename });

      try {
        await adapter.transaction(async (client) => {
          await client.query(migration.sql);
          const upFilename = getCorrespondingFilename(migration.filename, "up");
          await markAsRolledBack(client, upFilename);
          pending--;
          logger.info("Migration rolled back successfully", { filename: migration.filename });
        });
      } catch (error) {
        const tuskError = createRollbackError(
          migration.filename,
          error instanceof Error ? error : new Error(String(error))
        );
        logger.error("Migration rollback failed", {
          filename: migration.filename,
          error: formatTuskError(tuskError)
        });
        throw new Error(formatTuskError(tuskError));
      }
    }

    logger.info("Migration down process completed", { executed: migrationsToRollback.length });
    return { executed: migrationsToRollback.length, pending };
  } finally {
    // Always release the lock, even if an error occurred
    await adapter.releaseMigrationLock();
  }
};
