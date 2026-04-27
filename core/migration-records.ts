import type { DatabaseAdapter, QueryResultRow } from "../types/migrations.js";
import type { MigrationRecord } from "./track-migrations.js";

interface MigrationTableExistsRow extends QueryResultRow {
  migration_table: string | null;
}

interface MigrationChecksumColumnRow extends QueryResultRow {
  has_checksum: boolean;
}

interface MigrationRecordRow extends QueryResultRow {
  filename: string;
  checksum: string | null;
  executed_at: Date;
}

interface MigrationTableState {
  exists: boolean;
  hasChecksum: boolean;
}

const migrationTableExists = async (adapter: DatabaseAdapter): Promise<boolean> => {
  const result = await adapter.query<MigrationTableExistsRow>(
    `SELECT to_regclass('_migrations')::text AS migration_table`
  );

  return result.rows[0]?.migration_table === "_migrations";
};

const migrationTableHasChecksum = async (
  adapter: DatabaseAdapter
): Promise<boolean> => {
  const result = await adapter.query<MigrationChecksumColumnRow>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = '_migrations'
      AND column_name = 'checksum'
    ) AS has_checksum
  `);

  return result.rows[0]?.has_checksum === true;
};

export const getMigrationTableStateReadOnly = async (
  adapter: DatabaseAdapter
): Promise<MigrationTableState> => {
  const exists = await migrationTableExists(adapter);
  return {
    exists,
    hasChecksum: exists ? await migrationTableHasChecksum(adapter) : false,
  };
};

export const getExecutedMigrationRecordsReadOnly = async (
  adapter: DatabaseAdapter
): Promise<MigrationRecord[]> => {
  const tableState = await getMigrationTableStateReadOnly(adapter);
  if (!tableState.exists) {
    return [];
  }

  const checksumSelection = tableState.hasChecksum ? "checksum" : "NULL::text AS checksum";
  const result = await adapter.query<MigrationRecordRow>(`
    SELECT filename, ${checksumSelection}, executed_at
    FROM _migrations
    ORDER BY id ASC
  `);

  return result.rows.map((row) => ({
    filename: row.filename,
    checksum: row.checksum,
    executed_at: row.executed_at,
  }));
};

export const getLastExecutedMigrationFilenamesReadOnly = async (
  adapter: DatabaseAdapter,
  count?: number
): Promise<string[]> => {
  if (!(await migrationTableExists(adapter))) {
    return [];
  }

  const limit = count ?? Number.MAX_SAFE_INTEGER;
  const result = await adapter.query<MigrationRecordRow>(
    `SELECT filename FROM _migrations ORDER BY id DESC LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => row.filename);
};
