import type {
  DatabaseAdapter,
  MigrationRecord,
  TransactionClient,
} from "../types/migrations.js";
import { logger } from "../utils/logger.js";
import { assertMigrationTableShape } from "./migration-records.js";
import type { MigrationFilenameRow, MigrationRecordRow } from "./migration-row-types.js";

export const ensureMigrationsTable = async (adapter: DatabaseAdapter) => {
  await adapter.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW(),
      checksum VARCHAR(64)
    );
  `);

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

  await assertMigrationTableShape(adapter);
  logger.debug("Migrations table structure ensured");
};

export const getExecutedMigrations = async (
  adapter: DatabaseAdapter
): Promise<Set<string>> => {
  await assertMigrationTableShape(adapter);
  const result = await adapter.query<MigrationFilenameRow>(`
    SELECT filename FROM _migrations
  `);

  return new Set(result.rows.map((row) => row.filename));
};

export const getLastExecutedMigrations = async (
  adapter: DatabaseAdapter,
  count?: number
): Promise<string[]> => {
  await assertMigrationTableShape(adapter);
  const limit = count ?? Number.MAX_SAFE_INTEGER;
  const result = await adapter.query<MigrationFilenameRow>(
    `SELECT filename FROM _migrations ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => row.filename);
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

export const getExecutedMigrationsWithChecksums = async (
  adapter: DatabaseAdapter
): Promise<MigrationRecord[]> => {
  await assertMigrationTableShape(adapter);
  const result = await adapter.query<MigrationRecordRow>(`
    SELECT filename, checksum, executed_at
    FROM _migrations
    ORDER BY id ASC
  `);

  return result.rows.map((row) => ({
    filename: row.filename,
    checksum: row.checksum,
    executed_at: row.executed_at,
  }));
};
