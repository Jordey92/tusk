import type { Migration, MigrationRecord } from "../types/migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import { createValidationError } from "../utils/errors.js";

export const assertExecutedMigrationChecksums = (
  migrationsFromDirectory: Migration[],
  executedMigrations: MigrationRecord[]
) => {
  for (const executedMigration of executedMigrations) {
    if (!executedMigration.checksum) {
      continue;
    }

    const migrationFile = migrationsFromDirectory.find(
      (migration) => migration.filename === executedMigration.filename
    );

    if (!migrationFile) {
      continue;
    }

    const currentChecksum = calculateChecksum(migrationFile.sql);
    if (currentChecksum !== executedMigration.checksum) {
      throw createValidationError(
        `Migration file ${executedMigration.filename} has been modified after execution. ` +
          `This is not allowed. Original checksum: ${executedMigration.checksum}, ` +
          `current checksum: ${currentChecksum}`,
        { filename: executedMigration.filename }
      );
    }
  }
};
