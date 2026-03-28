import type { Migration } from "../types/migrations.js";
import { createValidationError } from "../utils/errors.js";
import { getCorrespondingFilename } from "../utils/filename.js";

/**
 * Resolves the rollback files for the executed migrations and fails fast when any are missing.
 */
export const planRollbackMigrations = (
  executedUpFilenames: string[],
  downMigrations: Migration[]
): Migration[] => {
  const downByFilename = new Map(
    downMigrations.map((migration) => [migration.filename, migration])
  );

  return executedUpFilenames.map((upFilename) => {
    const downFilename = getCorrespondingFilename(upFilename, "down");
    const migration = downByFilename.get(downFilename);

    if (!migration) {
      throw createValidationError(
        `Missing rollback migration file: ${downFilename}`,
        { upFilename, downFilename }
      );
    }

    return migration;
  });
};
