import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import type {
  DatabaseAdapter,
  QueryClient,
  QueryResultRow,
  TransactionClient,
} from "../types/migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import { logger } from "../utils/logger.js";
import {
  createBaselineUnsupportedError,
  createMigrationFileError,
  toError,
} from "../utils/errors.js";
import { ensureMigrationsTable, markAsExecuted } from "./track-migrations.js";
import {
  INITIAL_DOWN_MIGRATION_FILENAME,
  INITIAL_UP_MIGRATION_FILENAME,
} from "./baseline.js";
import { assertBaselineCompatible } from "./baseline-compatibility.js";
import { withMigrationLock } from "./migration-lock.js";

export interface InitMigrationResult {
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
  adapter: QueryClient,
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
  adapter: QueryClient,
  filename: string,
  checksum: string
) => {
  const existing = await readBaselineMigrationRecord(adapter, filename);

  if (!existing.checksum || existing.checksum === checksum) {
    return;
  }

  throw createBaselineUnsupportedError(
    `Initial migration ${filename} is already recorded with a different checksum`,
    { filename, expectedChecksum: checksum, recordedChecksum: existing.checksum }
  );
};

const recordBaselineMigration = async (
  adapter: TransactionClient,
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

const ensureBaselineFile = async (
  filePath: string,
  filename: string,
  content: string
) => {
  try {
    await writeFile(filePath, content, { flag: "wx" });
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
    if (code !== "EEXIST") {
      throw createMigrationFileError(
        filename,
        "Baseline file could not be created",
        toError(error)
      );
    }

    const existing = await readFile(filePath, "utf8");
    if (existing !== content) {
      throw createMigrationFileError(
        filename,
        "Existing baseline file differs from the current database schema"
      );
    }

    return false;
  }
};

const createInitialMigrationWithLock = async (
  adapter: DatabaseAdapter,
  migrationsPath: string,
  schema: string
): Promise<InitMigrationResult> => {
  const introspectedSchema = await adapter.introspectDatabase(schema);

  if (introspectedSchema.tables.length === 0) {
    logger.warn("No tables found in database");
    throw createBaselineUnsupportedError(
      "No tables found in database to introspect",
      { schema }
    );
  }

  await assertBaselineCompatible(adapter, schema);

  const upSQL = adapter.generateUpMigration(introspectedSchema);
  const downSQL = adapter.generateDownMigration(introspectedSchema);
  const upFilename = INITIAL_UP_MIGRATION_FILENAME;
  const downFilename = INITIAL_DOWN_MIGRATION_FILENAME;
  const path = resolve(migrationsPath);
  const checksum = calculateChecksum(upSQL);

  await ensureMigrationsTable(adapter);
  await assertBaselineRecordCompatible(adapter, upFilename, checksum);
  await mkdir(path, { recursive: true });

  const upPath = resolve(path, upFilename);
  const downPath = resolve(path, downFilename);
  const createdPaths: string[] = [];

  try {
    if (await ensureBaselineFile(upPath, upFilename, upSQL)) {
      createdPaths.push(upPath);
    }
    if (await ensureBaselineFile(downPath, downFilename, downSQL)) {
      createdPaths.push(downPath);
    }

    await adapter.transaction(async (client) => {
      await assertBaselineRecordCompatible(client, upFilename, checksum);
      await recordBaselineMigration(client, upFilename, checksum);
    });
  } catch (error) {
    await Promise.all(createdPaths.map((createdPath) =>
      rm(createdPath).catch(() => undefined)
    ));
    throw error;
  }

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
  return withMigrationLock(adapter, "init-from-db", () =>
    createInitialMigrationWithLock(adapter, migrationsPath, schema)
  );
};
