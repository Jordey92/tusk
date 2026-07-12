import { createValidationError } from "../utils/errors.js";
import type { NormalizedRollbackTarget } from "./rollback-target.js";

const INITIAL_MIGRATION_TIMESTAMP = "0000000000000";
const INITIAL_MIGRATION_NAME = "initial";
export const INITIAL_UP_MIGRATION_FILENAME =
  `${INITIAL_MIGRATION_TIMESTAMP}_${INITIAL_MIGRATION_NAME}.up.sql`;
export const INITIAL_DOWN_MIGRATION_FILENAME =
  `${INITIAL_MIGRATION_TIMESTAMP}_${INITIAL_MIGRATION_NAME}.down.sql`;

export const assertBaselineRollbackAllowed = (
  executedFilenames: string[],
  target: NormalizedRollbackTarget
) => {
  if (
    executedFilenames.includes(INITIAL_UP_MIGRATION_FILENAME) &&
    !target.allowBaselineRollback
  ) {
    throw createValidationError(
      "Refusing to roll back the adopted baseline because it can remove the pre-existing schema. " +
        "Pass allowBaselineRollback explicitly only after reviewing the full down migration.",
      {
        filename: INITIAL_UP_MIGRATION_FILENAME,
        allowBaselineRollback: false,
      }
    );
  }
};
