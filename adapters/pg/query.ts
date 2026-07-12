import type {
  ConnectionClient,
  ConnectionPool,
  DatabaseAdapterOptions,
  QueryClient,
  QueryParam,
  TransactionClient,
  QueryResultRow,
} from "../../types/migrations.js";
import { logger } from "../../utils/logger.js";
import { createConfigurationError, createMigrationLockedError } from "../../utils/errors.js";

const DEFAULT_STATEMENT_TIMEOUT_MS = 300000;

type ActiveClientResolver = () => ConnectionClient | null;

const normalizeStatementTimeout = (options: DatabaseAdapterOptions) => {
  const value = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createConfigurationError(
      "statementTimeoutMs must be a non-negative safe integer; use 0 to keep the PostgreSQL default",
      { statementTimeoutMs: value }
    );
  }
  return value;
};

export const createExecuteQuery = (
  pool: QueryClient,
  getActiveClient: ActiveClientResolver = () => null
) => {
  let activeClientTail: Promise<void> = Promise.resolve();

  return async <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: QueryParam[]
  ) => {
    logger.debug("Executing query", {
      sql: sql.substring(0, 100),
      paramCount: params?.length,
    });
    const activeClient = getActiveClient();
    if (!activeClient) {
      return await pool.query<T>(sql, params);
    }

    // node-postgres clients accept only one active query at a time. Baseline
    // introspection deliberately fans out independent reads, so serialize them
    // while they share the dedicated advisory-lock connection.
    const queryResult = activeClientTail.then(() =>
      activeClient.query<T>(sql, params)
    );
    activeClientTail = queryResult.then(() => undefined, () => undefined);
    return await queryResult;
  };
};

export const createTransaction = (
  pool: ConnectionPool,
  getActiveClient: ActiveClientResolver = () => null,
  options: DatabaseAdapterOptions = {}
) => {
  const statementTimeoutMs = normalizeStatementTimeout(options);
  let transactionActive = false;

  return async <T>(callback: (client: TransactionClient) => Promise<T>): Promise<T> => {
    if (transactionActive) {
      throw createMigrationLockedError(
        "This adapter is already running a transaction",
        { scope: "transaction" }
      );
    }

    transactionActive = true;
    const activeClient = getActiveClient();
    const client: ConnectionClient = activeClient ?? await pool.connect();
    const ownsClient = !activeClient;
    let transactionStarted = false;

    try {
      logger.debug("Starting database transaction");
      await client.query("BEGIN");
      transactionStarted = true;

      if (statementTimeoutMs > 0) {
        await client.query(
          `SET LOCAL statement_timeout = '${statementTimeoutMs}'`
        );
        logger.debug(`Transaction timeout set to ${statementTimeoutMs}ms`);
      }

      const transactionClient: TransactionClient = {
        query: async <T extends QueryResultRow = QueryResultRow>(
          sql: string,
          params?: QueryParam[]
        ) => {
          logger.debug("Executing transaction query", {
            sql: sql.substring(0, 100),
          });
          return await client.query<T>(sql, params);
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
            originalError:
              error instanceof Error ? error.message : String(error),
            rollbackError:
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
          });
        }
      }

      logger.error("Transaction failed", {
        error: error instanceof Error ? error.message : String(error),
        transactionStarted,
      });
      throw error;
    } finally {
      transactionActive = false;
      if (ownsClient) {
        client.release();
        logger.debug("Database client released");
      }
    }
  };
};
