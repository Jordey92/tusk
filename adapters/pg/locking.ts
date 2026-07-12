import type {
  ConnectionClient,
  ConnectionPool,
  QueryResultRow,
} from "../../types/migrations.js";
import { logger } from "../../utils/logger.js";
import { createMigrationLockedError } from "../../utils/errors.js";

const MIGRATION_LOCK_ID = 123456789;

interface LockRow extends QueryResultRow {
  acquired: boolean;
}

interface UnlockRow extends QueryResultRow {
  unlocked: boolean;
}

export const createLockingMethods = (pool: ConnectionPool) => {
  let lockClient: ConnectionClient | null = null;
  let releasePromise: Promise<void> | null = null;

  return {
    acquireMigrationLock: async () => {
      if (lockClient) {
        throw createMigrationLockedError(
          "This adapter is already running a migration operation. Wait for it to finish or use a separate adapter.",
          { scope: "adapter" }
        );
      }

      logger.debug("Attempting to acquire migration lock");
      const client = await pool.connect();
      let lockAcquired = false;

      try {
        const result = await client.query<LockRow>(
          "SELECT pg_try_advisory_lock($1) as acquired",
          [MIGRATION_LOCK_ID]
        );

        const lockResult = result.rows[0];
        if (!lockResult || !lockResult.acquired) {
          logger.warn(
            "Migration lock acquisition failed - another process is running migrations"
          );
          throw createMigrationLockedError(
            "Another migration process is currently running. " +
              "Please wait for it to complete before running migrations again.",
            { scope: "database" }
          );
        }

        lockClient = client;
        lockAcquired = true;
        logger.info("Migration lock acquired successfully");
      } finally {
        if (!lockAcquired) {
          client.release();
        }
      }
    },

    // Stop routing new work to the dedicated client as soon as release starts,
    // while retaining it internally so lock acquisition remains blocked.
    getActiveLockClient: () => releasePromise ? null : lockClient,

    releaseMigrationLock: async () => {
      if (releasePromise) {
        await releasePromise;
        return;
      }

      if (!lockClient) {
        logger.debug("No migration lock held by current adapter");
        return;
      }

      logger.debug("Releasing migration lock");
      const client = lockClient;

      try {
        // Defer the unlock to a microtask so releasePromise is observable before
        // the client query begins, even if a driver throws synchronously.
        releasePromise = Promise.resolve().then(async () => {
          try {
            const result = await client.query<UnlockRow>(
              "SELECT pg_advisory_unlock($1) AS unlocked",
              [MIGRATION_LOCK_ID]
            );
            if (!result.rows[0]?.unlocked) {
              throw createMigrationLockedError(
                "The database connection did not retain the advisory lock session. " +
                  "Use a direct or session-pooled PostgreSQL endpoint instead of a transaction pooler.",
                { scope: "database", phase: "release" }
              );
            }
            logger.debug("Migration lock released successfully");
          } finally {
            lockClient = null;
            client.release();
          }
        });
        await releasePromise;
      } finally {
        releasePromise = null;
      }
    },
  };
};
