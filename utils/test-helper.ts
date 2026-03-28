import "dotenv/config";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { createPgAdapter } from "../adapters/pg.js";

const TEST_CONNECTION = {
  user: "user",
  host: "localhost",
  database: "migrate_tool_test",
  password: "password",
  port: 5433,
};

const ADMIN_DATABASE = "postgres";

const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, "\"\"")}"`;

export interface TemporaryDatabaseHandle {
  name: string;
  pool: Pool;
  connectionString: string;
  cleanup(): Promise<void>;
}

export const createTestPool = (database: string = TEST_CONNECTION.database) => {
  return new Pool({
    ...TEST_CONNECTION,
    database,
  });
};

export const cleanupMigrations = async (pool: Pool) => {
  await pool.query(`
    DO $$
    DECLARE
      schema_name text;
    BEGIN
      FOR schema_name IN
        SELECT nspname
        FROM pg_namespace
        WHERE nspname NOT IN ('public', 'information_schema', 'pg_catalog')
          AND nspname NOT LIKE 'pg_toast%'
          AND nspname NOT LIKE 'pg_temp_%'
      LOOP
        EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
      END LOOP;
    END $$;

    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
  `);
};

/**
 * Creates an isolated database and hides the teardown details from callers.
 */
export const createTemporaryDatabase = async (
  prefix: string = "tusk_test"
): Promise<TemporaryDatabaseHandle> => {
  const adminPool = createTestPool(ADMIN_DATABASE);
  const name = `${prefix}_${randomUUID().replace(/-/g, "")}`;
  const quotedName = quoteIdentifier(name);

  await adminPool.query(`CREATE DATABASE ${quotedName}`);

  const pool = createTestPool(name);
  const connectionString =
    `postgresql://${TEST_CONNECTION.user}:${TEST_CONNECTION.password}` +
    `@${TEST_CONNECTION.host}:${TEST_CONNECTION.port}/${name}`;

  return {
    name,
    pool,
    connectionString,
    async cleanup() {
      await pool.end();
      await adminPool.query(
        `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
        `,
        [name]
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${quotedName}`);
      await adminPool.end();
    },
  };
};

export const createTemporaryDatabaseAdapter = async (
  prefix?: string
) => {
  const database = await createTemporaryDatabase(prefix);

  return {
    ...database,
    adapter: createPgAdapter(database.pool),
  };
};
