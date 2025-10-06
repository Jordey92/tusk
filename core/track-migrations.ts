import type { DatabaseAdapter, TransactionClient } from "../types/migrations";

export const ensureMigrationsTable = async (adapter: DatabaseAdapter) => {
  await adapter.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT NOW()
  );
`);
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
  filename: string
) => {
  await adapterOrClient.query(
    `INSERT INTO _migrations (filename) VALUES ($1)`,
    [filename]
  );
};

export const markAsRolledBack = async (
  adapterOrClient: DatabaseAdapter | TransactionClient,
  filename: string
) => {
  await adapterOrClient.query(`DELETE FROM _migrations WHERE filename = ($1)`, [
    filename,
  ]);
};
