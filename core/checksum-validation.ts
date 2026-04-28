import type { Migration, MigrationRecord } from "../types/migrations.js";
import { calculateChecksum } from "../utils/checksum.js";
import { createValidationError } from "../utils/errors.js";

export const assertExecutedMigrationChecksums = (
  migrationsFromDirectory: Migration[],
  executedMigrations: MigrationRecord[]
) => {
  for (const executedMigration of executedMigrations) {
    const migrationFile = migrationsFromDirectory.find(
      (migration) => migration.filename === executedMigration.filename
    );

    if (!migrationFile) {
      throw createValidationError(
        `Executed migration ${executedMigration.filename} is missing from the migrations directory. ` +
          "Restore the migration file or repair migration metadata before running migrations.",
        { filename: executedMigration.filename }
      );
    }

    if (!executedMigration.checksum) {
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
