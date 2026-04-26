import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import type { DatabaseAdapter, QueryResultRow } from "../types/migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import { logger } from "../utils/logger.js";
import { ensureMigrationsTable, markAsExecuted } from "./track-migrations.js";

// Initial migration uses timestamp 0 to ensure it runs first
const INITIAL_MIGRATION_TIMESTAMP = "0000000000000";
const INITIAL_MIGRATION_NAME = "initial";

interface InitMigrationResult {
  upFile: string;
  downFile: string;
  tableCount: number;
  checksum: string;
  markedAsExecuted: boolean;
}

interface BaselineMigrationRow extends QueryResultRow {
  checksum: string | null;
}

interface BaselineMigrationRecord {
  exists: boolean;
  checksum: string | null;
}

const readBaselineMigrationRecord = async (
  adapter: DatabaseAdapter,
  filename: string
): Promise<BaselineMigrationRecord> => {
  const existing = await adapter.query<BaselineMigrationRow>(
    `SELECT checksum FROM _migrations WHERE filename = $1`,
    [filename]
  );

  const row = existing.rows[0];
  if (!row) {
    return { exists: false, checksum: null };
  }

  return { exists: true, checksum: row.checksum };
};

const assertBaselineRecordCompatible = async (
  adapter: DatabaseAdapter,
  filename: string,
  checksum: string
) => {
  const existing = await readBaselineMigrationRecord(adapter, filename);

  if (!existing.checksum || existing.checksum === checksum) {
    return;
  }

  throw new Error(
    `Initial migration ${filename} is already recorded with a different checksum`
  );
};

const recordBaselineMigration = async (
  adapter: DatabaseAdapter,
  filename: string,
  checksum: string
) => {
  const existing = await readBaselineMigrationRecord(adapter, filename);

  if (existing.checksum === checksum) {
    return;
  }

  if (existing.exists) {
    await adapter.query(
      `UPDATE _migrations SET checksum = $2 WHERE filename = $1`,
      [filename, checksum]
    );
    return;
  }

  await markAsExecuted(adapter, filename, checksum);
};

/**
 * Create initial migration files from existing database schema and mark
 * the generated baseline as already applied.
 */
export const createInitialMigration = async (
  adapter: DatabaseAdapter,
  migrationsPath: string,
  schema: string = "public"
): Promise<InitMigrationResult> => {
  logger.info("Creating initial migration from existing schema", { migrationsPath, schema });

  // Introspect the database
  const introspectedSchema = await adapter.introspectDatabase(schema);

  if (introspectedSchema.tables.length === 0) {
    logger.warn("No tables found in database");
    throw new Error("No tables found in database to introspect");
  }

  // Generate UP and DOWN migrations
  const upSQL = adapter.generateUpMigration(introspectedSchema);
  const downSQL = adapter.generateDownMigration(introspectedSchema);

  // Create migration filenames
  const upFilename = `${INITIAL_MIGRATION_TIMESTAMP}_${INITIAL_MIGRATION_NAME}.up.sql`;
  const downFilename = `${INITIAL_MIGRATION_TIMESTAMP}_${INITIAL_MIGRATION_NAME}.down.sql`;

  const path = resolve(migrationsPath);
  const checksum = calculateChecksum(upSQL);

  await ensureMigrationsTable(adapter);
  await assertBaselineRecordCompatible(adapter, upFilename, checksum);

  // Ensure migrations directory exists
  await mkdir(path, { recursive: true });

  // Write migration files
  const upPath = resolve(path, upFilename);
  const downPath = resolve(path, downFilename);

  await writeFile(upPath, upSQL);
  await writeFile(downPath, downSQL);

  await recordBaselineMigration(adapter, upFilename, checksum);

  logger.info("Initial migration created successfully", {
    upFile: upFilename,
    downFile: downFilename,
    tableCount: introspectedSchema.tables.length,
    checksum,
  });

  return {
    upFile: upFilename,
    downFile: downFilename,
    tableCount: introspectedSchema.tables.length,
    checksum,
    markedAsExecuted: true,
  };
};
