import { Pool } from "pg";
import type {
  DatabaseAdapter,
  TransactionClient,
} from "../types/migrations";
import { logger } from "../utils/logger";

export const createPostgresAdapter = (pool: Pool): DatabaseAdapter => ({
  query: async (sql: string, params?: any[]) => {
    try {
      logger.debug("Executing query", { sql: sql.substring(0, 100), paramCount: params?.length });
      return await pool.query(sql, params);
    } catch (error) {
      logger.error("Query execution failed", {
        sql: sql.substring(0, 100),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  },

  transaction: async (callback) => {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      logger.debug("Starting database transaction");
      await client.query("BEGIN");
      transactionStarted = true;

      const transactionClient: TransactionClient = {
        query: async (sql: string, params?: any[]) => {
          try {
            logger.debug("Executing transaction query", { sql: sql.substring(0, 100) });
            return await client.query(sql, params);
          } catch (error) {
            logger.error("Transaction query failed", {
              sql: sql.substring(0, 100),
              error: error instanceof Error ? error.message : String(error)
            });
            throw error;
          }
        },
      };

      const result = await callback(transactionClient);

      logger.debug("Committing transaction");
      await client.query("COMMIT");
      logger.debug("Transaction committed successfully");
      return result;

    } catch (error) {
      if (transactionStarted) {
        try {
          logger.debug("Rolling back transaction due to error");
          await client.query("ROLLBACK");
          logger.debug("Transaction rolled back successfully");
        } catch (rollbackError) {
          logger.error("Failed to rollback transaction", {
            originalError: error instanceof Error ? error.message : String(error),
            rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }
      }

      logger.error("Transaction failed", {
        error: error instanceof Error ? error.message : String(error),
        transactionStarted
      });
      throw error;

    } finally {
      try {
        client.release();
        logger.debug("Database client released");
      } catch (releaseError) {
        logger.warn("Failed to release database client", {
          error: releaseError instanceof Error ? releaseError.message : String(releaseError)
        });
      }
    }
  },
});
