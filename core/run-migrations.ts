// runUp(db, options) - figures out pending migrations, runs them in transactions
// runDown(db, count) - figures out which to rollback, runs the .down.sql files
// Uses the functions from read and track

import type { DatabaseAdapter, RunResult } from "../types/migrations";
import { getCorrespondingFilename } from "../utils/filename";
import { logger } from "../utils/logger";
import { createDatabaseError, createMigrationExecutionError, createRollbackError, formatTuskError } from "../utils/errors";
import { readMigrations } from "./read-migrations";
import {
  ensureMigrationsTable,
  getExecutedMigrations,
  getLastExecutedMigrations,
  markAsExecuted,
  markAsRolledBack,
} from "./track-migrations";

export const runUp = async (
  adapter: DatabaseAdapter,
  migrationsPath: string
): Promise<RunResult> => {
  logger.info("Starting migration up process", { migrationsPath });

  try {
    await ensureMigrationsTable(adapter);
    logger.debug("Migrations table ensured");
  } catch (error) {
    const tuskError = createDatabaseError(
      "Failed to ensure migrations table exists. Check database connection.",
      error instanceof Error ? error : new Error(String(error))
    );
    logger.error("Database connection failed", { error: formatTuskError(tuskError) });
    throw new Error(formatTuskError(tuskError));
  }

  const migrationsFromDirectoy = await readMigrations(migrationsPath, "up");
  const migrationsFromDb = await getExecutedMigrations(adapter);

  const migrationsToRun = migrationsFromDirectoy.filter(
    (migration) =>
      !migrationsFromDb.has(migration.filename) &&
      migration.filename.endsWith(".up.sql")
  );

  logger.info("Found migrations to execute", {
    total: migrationsFromDirectoy.length,
    toExecute: migrationsToRun.length,
    alreadyExecuted: migrationsFromDb.size
  });

  let pending = migrationsToRun.length;

  for (const migration of migrationsToRun) {
    logger.debug("Executing migration", { filename: migration.filename });

    try {
      await adapter.transaction(async (client) => {
        await client.query(migration.sql);
        await markAsExecuted(client, migration.filename);
        pending--;
        logger.info("Migration executed successfully", { filename: migration.filename });
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
};

export const runDown = async (
  adapter: DatabaseAdapter,
  migrationsPath: string,
  count?: number
): Promise<RunResult> => {
  logger.info("Starting migration down process", { migrationsPath, count });

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
};
