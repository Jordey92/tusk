import type { MigrationAdapter } from "../types/migrations.js";
import { toError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const withMigrationLock = async <T>(
  adapter: MigrationAdapter,
  operation: string,
  callback: () => Promise<T>
): Promise<T> => {
  await adapter.acquireMigrationLock();
  let operationError: unknown;

  try {
    return await callback();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await adapter.releaseMigrationLock();
    } catch (releaseError) {
      if (!operationError) throw releaseError;

      logger.error("Migration lock release also failed", {
        operation,
        operationError: toError(operationError).message,
        releaseError: toError(releaseError).message,
      });
    }
  }
};
