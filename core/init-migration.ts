import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import type { DatabaseAdapter } from "../types/migrations";
import { logger } from "../utils/logger";

// Initial migration uses timestamp 0 to ensure it runs first
const INITIAL_MIGRATION_TIMESTAMP = "0000000000000";
const INITIAL_MIGRATION_NAME = "initial";

export interface InitMigrationResult {
  upFile: string;
  downFile: string;
  tableCount: number;
}

/**
 * Create initial migration files from existing database schema
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

  // Ensure migrations directory exists
  const path = resolve(migrationsPath);
  await mkdir(path, { recursive: true });

  // Write migration files
  const upPath = resolve(path, upFilename);
  const downPath = resolve(path, downFilename);

  await writeFile(upPath, upSQL);
  await writeFile(downPath, downSQL);

  logger.info("Initial migration created successfully", {
    upFile: upFilename,
    downFile: downFilename,
    tableCount: introspectedSchema.tables.length,
  });

  return {
    upFile: upFilename,
    downFile: downFilename,
    tableCount: introspectedSchema.tables.length,
  };
};
