import type postgres from "postgres";
import type { QueryResultRow } from "pg";
import type {
  ConnectionClient,
  ConnectionPool,
  QueryParam,
  QueryResult,
} from "../types/migrations.js";
import type { DatabaseAdapter } from "../types/migrations.js";
import { createPgAdapter } from "./pg.js";

type PostgresJsResult<T extends QueryResultRow> = T[] & {
  count: number | null;
  command: string;
};

const toQueryResult = <T extends QueryResultRow>(
  result: PostgresJsResult<T>
): QueryResult<T> => ({
  rows: result,
  rowCount: result.count,
});

const createUnsafeQueryExecutor =
  <TExecutor extends Pick<postgres.Sql, "unsafe">>(executor: TExecutor) =>
  async <T extends QueryResultRow = QueryResultRow>(
    queryString: string,
    params?: QueryParam[]
  ): Promise<QueryResult<T>> => {
    const result = await executor.unsafe<T[]>(queryString, params);
    return toQueryResult(result);
  };

/**
 * Creates a DatabaseAdapter for postgres.js (https://github.com/porsager/postgres)
 *
 * This is a thin wrapper that makes postgres.Sql compatible with the pg.Pool interface,
 * allowing Tusk to work with both pg and postgres.js clients.
 *
 * @param sql - postgres.js client instance
 * @returns DatabaseAdapter compatible with Tusk
 *
 * @example
 * ```typescript
 * import postgres from 'postgres'
 * import { createPostgresJsAdapter } from '@bydey/tusk'
 *
 * const sql = postgres(process.env.DATABASE_URL)
 * const adapter = createPostgresJsAdapter(sql)
 *
 * // Use with Tusk
 * await runUp(adapter, './migrations')
 * ```
 */
export const createPostgresJsAdapter = (
  sql: postgres.Sql
): DatabaseAdapter => {
  const query = createUnsafeQueryExecutor(sql);

  const poolLike: ConnectionPool = {
    query,
    connect: async (): Promise<ConnectionClient> => {
      const reserved = await sql.reserve();
      const reservedQuery = createUnsafeQueryExecutor(reserved);

      return {
        query: reservedQuery,
        release: () => reserved.release(),
      };
    },
  };

  return createPgAdapter(poolLike);
};
