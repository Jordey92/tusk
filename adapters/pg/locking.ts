import type { QueryResultRow } from "pg";
import type { QueryParam } from "../../types/migrations.js";
import { logger } from "../../utils/logger.js";

const MIGRATION_LOCK_ID = 123456789;

interface LockRow extends QueryResultRow {
  acquired: boolean;
}

interface LockClient {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: QueryParam[]
  ): Promise<{ rows: T[] }>;
  release(): void;
}

interface LockConnection {
  connect(): Promise<LockClient>;
}

export const createLockingMethods = (
  pool: LockConnection
) => {
  let lockClient: LockClient | null = null;

  return {
    acquireMigrationLock: async () => {
      if (lockClient) {
        logger.debug("Migration lock already held by current adapter");
        return;
      }

      logger.debug("Attempting to acquire migration lock");
      const client = await pool.connect();

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
          throw new Error(
            "Another migration process is currently running. " +
              "Please wait for it to complete before running migrations again."
          );
        }

        lockClient = client;
        logger.info("Migration lock acquired successfully");
      } catch (error) {
        client.release();
        throw error;
      }
    },

    releaseMigrationLock: async () => {
      if (!lockClient) {
        logger.debug("No migration lock held by current adapter");
        return;
      }

      logger.debug("Releasing migration lock");
      const client = lockClient;
      lockClient = null;

      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
        logger.debug("Migration lock released successfully");
      } finally {
        client.release();
      }
    },
  };
};
