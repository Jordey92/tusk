import { createValidationError } from "../utils/errors.js";

export type RollbackTarget =
  | number
  | {
      count?: number;
      all?: boolean;
      allowBaselineRollback?: boolean;
    };

export type NormalizedRollbackTarget =
  | {
      mode: "count";
      count: number;
      requestedCount: number;
      allowBaselineRollback: boolean;
    }
  | {
      mode: "all";
      allowBaselineRollback: boolean;
    };

const DEFAULT_ROLLBACK_COUNT = 1;

const assertPositiveInteger = (count: number) => {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw createValidationError(
      "Rollback count must be a positive integer",
      { count }
    );
  }
};

export const normalizeRollbackTarget = (
  target?: RollbackTarget
): NormalizedRollbackTarget => {
  if (typeof target === "number") {
    assertPositiveInteger(target);
    return {
      mode: "count",
      count: target,
      requestedCount: target,
      allowBaselineRollback: false,
    };
  }

  if (target?.all && target.count !== undefined) {
    throw createValidationError(
      "Rollback target cannot combine all with a count",
      { count: target.count, all: true }
    );
  }

  if (target?.all) {
    return {
      mode: "all",
      allowBaselineRollback: target.allowBaselineRollback ?? false,
    };
  }

  const count = target?.count ?? DEFAULT_ROLLBACK_COUNT;
  assertPositiveInteger(count);
  return {
    mode: "count",
    count,
    requestedCount: count,
    allowBaselineRollback: target?.allowBaselineRollback ?? false,
  };
};
