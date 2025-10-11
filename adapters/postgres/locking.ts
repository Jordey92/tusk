import type { QueryResultRow } from "pg";
import type { QueryParam } from "../../types/migrations.js";
import { logger } from "../../utils/logger.js";

const MIGRATION_LOCK_ID = 123456789;

interface LockRow extends QueryResultRow {
  acquired: boolean;
}

export const createLockingMethods = (
  executeQuery: <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: QueryParam[]
  ) => Promise<{ rows: T[] }>
) => {
  return {
    acquireMigrationLock: async () => {
      logger.debug("Attempting to acquire migration lock");

      const result = await executeQuery<LockRow>(
        "SELECT pg_try_advisory_lock($1) as acquired",
        [MIGRATION_LOCK_ID]
      );

      const lockResult = result.rows[0];
      if (!lockResult || !lockResult.acquired) {
        logger.warn(
          "Migration lock acquisition failed - another process is running migrations"
        );
        throw new Error(
          "Another migration process is currently running. " +
            "Please wait for it to complete before running migrations again."
        );
      }

      logger.info("Migration lock acquired successfully");
    },

    releaseMigrationLock: async () => {
      logger.debug("Releasing migration lock");

      await executeQuery("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);

      logger.debug("Migration lock released successfully");
    },
  };
};
