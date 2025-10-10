import type { DatabaseAdapter, TransactionClient } from "../types/migrations";
import { logger } from "../utils/logger";

export const ensureMigrationsTable = async (adapter: DatabaseAdapter) => {
  // Create table if it doesn't exist
  await adapter.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Add checksum column if it doesn't exist (backward compatible)
  await adapter.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = '_migrations'
        AND column_name = 'checksum'
      ) THEN
        ALTER TABLE _migrations ADD COLUMN checksum VARCHAR(64);
      END IF;
    END $$;
  `);

  logger.debug("Migrations table structure ensured");
};

export const getExecutedMigrations = async (
  adapter: DatabaseAdapter
): Promise<Set<string>> => {
  const result = await adapter.query(`
    SELECT filename FROM _migrations
  `);

  return new Set(result.rows.map((row: any) => row.filename));
};

export const getLastExecutedMigrations = async (
  adapter: DatabaseAdapter,
  count?: number
): Promise<string[]> => {
  const limit = count ?? Number.MAX_SAFE_INTEGER;
  const result = await adapter.query(
    `SELECT filename FROM _migrations ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map((row: any) => row.filename);
};

export const markAsExecuted = async (
  adapterOrClient: DatabaseAdapter | TransactionClient,
  filename: string,
  checksum?: string
) => {
  if (checksum) {
    await adapterOrClient.query(
      `INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)`,
      [filename, checksum]
    );
  } else {
    await adapterOrClient.query(
      `INSERT INTO _migrations (filename) VALUES ($1)`,
      [filename]
    );
  }
};

export const markAsRolledBack = async (
  adapterOrClient: DatabaseAdapter | TransactionClient,
  filename: string
) => {
  await adapterOrClient.query(`DELETE FROM _migrations WHERE filename = ($1)`, [
    filename,
  ]);
};

export interface MigrationRecord {
  filename: string;
  checksum: string | null;
  executed_at: Date;
}

export const getExecutedMigrationsWithChecksums = async (
  adapter: DatabaseAdapter
): Promise<MigrationRecord[]> => {
  const result = await adapter.query(`
    SELECT filename, checksum, executed_at
    FROM _migrations
    ORDER BY id ASC
  `);

  return result.rows.map((row: any) => ({
    filename: row.filename,
    checksum: row.checksum,
    executed_at: row.executed_at,
  }));
};
