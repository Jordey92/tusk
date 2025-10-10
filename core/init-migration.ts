import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import type { DatabaseAdapter } from "../types/migrations";
import { logger } from "../utils/logger";

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

  // Create migration filenames with timestamp 0
  const upFilename = "0000000000000_initial.up.sql";
  const downFilename = "0000000000000_initial.down.sql";

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
