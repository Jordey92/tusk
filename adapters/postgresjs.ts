import type postgres from "postgres";
import type { DatabaseAdapter } from "../types/migrations.js";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { createPgAdapter } from "./pg.js";

/**
 * Pool-like interface that matches pg.Pool for query and connect methods
 */
interface PoolLike {
  query<T extends QueryResultRow = QueryResultRow>(
    queryString: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  connect(): Promise<ClientLike>;
}

/**
 * Client-like interface that matches pg.PoolClient for transactions
 */
interface ClientLike {
  query<T extends QueryResultRow = QueryResultRow>(
    queryString: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  release(): void;
}

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
  // Create a pg.Pool-like interface that wraps postgres.js
  const poolLike: PoolLike = {
    /**
     * Execute a query using postgres.js's .unsafe() method
     * This bypasses postgres.js's tagged template literals and allows
     * raw SQL with parameters, matching pg's interface
     */
    query: async <T extends QueryResultRow = QueryResultRow>(
      queryString: string,
      params?: unknown[]
    ): Promise<QueryResult<T>> => {
      // @ts-expect-error - Bridging pg's unknown[] params to postgres.js ParameterOrJSON[]
      const result = await sql.unsafe(queryString, params || []);
      return {
        rows: result as unknown as T[],
        rowCount: result.count ?? null,
        command: result.command ?? "",
        oid: 0,
        fields: [],
      };
    },

    /**
     * Reserve a connection for transactions
     * postgres.js uses .reserve() instead of .connect()
     */
    connect: async (): Promise<ClientLike> => {
      const reserved = await sql.reserve();
      return {
        query: async <T extends QueryResultRow = QueryResultRow>(
          queryString: string,
          params?: unknown[]
        ): Promise<QueryResult<T>> => {
          // @ts-expect-error - Bridging pg's unknown[] params to postgres.js ParameterOrJSON[]
          const result = await reserved.unsafe(queryString, params || []);
          return {
            rows: result as unknown as T[],
            rowCount: result.count ?? null,
            command: result.command ?? "",
            oid: 0,
            fields: [],
          };
        },
        release: () => reserved.release(),
      };
    },
  };

  return createPgAdapter(poolLike as Pool);
};
