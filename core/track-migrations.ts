import type {
  DatabaseAdapter,
  TransactionClient,
} from "../types/migrations.js";
import { logger } from "../utils/logger.js";
import {
  assertMigrationTableShape,
  getExecutedMigrationRecordsReadOnly,
  getLastExecutedMigrationFilenamesReadOnly,
  MIGRATION_METADATA_TABLE_NAME,
} from "./migration-records.js";

export const ensureMigrationsTable = async (adapter: DatabaseAdapter) => {
  await adapter.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_METADATA_TABLE_NAME} (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW(),
      checksum VARCHAR(64)
    );
  `);

  const tableState = await assertMigrationTableShape(adapter);

  if (tableState.state === "legacy_missing_checksum_column") {
    await adapter.query(`
      ALTER TABLE ${MIGRATION_METADATA_TABLE_NAME} ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
    `);

    await assertMigrationTableShape(adapter);
  }

  logger.debug("Migrations table structure ensured");
};

export const getExecutedMigrations = async (
  adapter: DatabaseAdapter
): Promise<Set<string>> => {
  const records = await getExecutedMigrationRecordsReadOnly(adapter);
  return new Set(records.map((row) => row.filename));
};

export const getLastExecutedMigrations =
  getLastExecutedMigrationFilenamesReadOnly;

export const markAsExecuted = async (
  adapterOrClient: DatabaseAdapter | TransactionClient,
  filename: string,
  checksum?: string
) => {
  if (checksum) {
    await adapterOrClient.query(
      `INSERT INTO ${MIGRATION_METADATA_TABLE_NAME} (filename, checksum) VALUES ($1, $2)`,
      [filename, checksum]
    );
  } else {
    await adapterOrClient.query(
      `INSERT INTO ${MIGRATION_METADATA_TABLE_NAME} (filename) VALUES ($1)`,
      [filename]
    );
  }
};

export const markAsRolledBack = async (
  adapterOrClient: DatabaseAdapter | TransactionClient,
  filename: string
) => {
  await adapterOrClient.query(
    `DELETE FROM ${MIGRATION_METADATA_TABLE_NAME} WHERE filename = ($1)`,
    [filename]
  );
};

export const getExecutedMigrationsWithChecksums =
  getExecutedMigrationRecordsReadOnly;
