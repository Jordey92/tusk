import type { StructuredContext } from "../types/structured.js";

export type TuskErrorCode =
  | "DATABASE_CONNECTION_FAILED"
  | "DRIVER_NOT_FOUND"
  | "MIGRATION_DIRECTORY_NOT_FOUND"
  | "MIGRATION_FILE_INVALID"
  | "MIGRATION_EXECUTION_FAILED"
  | "MIGRATION_LOCKED"
  | "BASELINE_UNSUPPORTED"
  | "METADATA_TABLE_INVALID"
  | "ROLLBACK_FAILED"
  | "VALIDATION_ERROR"
  | "CONFIGURATION_ERROR";

const DRIVER_NOT_FOUND_MESSAGE = `No supported Postgres client found.

Tusk needs a Postgres client to connect to your database.

Install one of:

  bun add pg
  bun add postgres

Recommended:

  bun add pg`;

export class TuskError extends Error {
  code: TuskErrorCode;
  override cause?: Error;
  context?: StructuredContext;

  constructor(
    code: TuskErrorCode,
    message: string,
    cause?: Error,
    context?: StructuredContext
  ) {
    super(message);
    this.name = "TuskError";
    this.code = code;
    this.cause = cause;
    this.context = context;
  }
}

export const createTuskError = (
  code: TuskErrorCode,
  message: string,
  cause?: Error,
  context?: StructuredContext
): TuskError => new TuskError(code, message, cause, context);

export const createDatabaseError = (message: string, cause?: Error, context?: StructuredContext): TuskError =>
  createTuskError("DATABASE_CONNECTION_FAILED", message, cause, context);

export const createDriverNotFoundError = (): TuskError =>
  createTuskError("DRIVER_NOT_FOUND", DRIVER_NOT_FOUND_MESSAGE);

export const createMigrationDirectoryError = (path: string, cause?: Error): TuskError =>
  createTuskError(
    "MIGRATION_DIRECTORY_NOT_FOUND",
    `Migrations directory not found: ${path}. Please create it or check the MIGRATIONS_PATH environment variable.`,
    cause,
    { path }
  );

export const createMigrationFileError = (filename: string, reason: string, cause?: Error): TuskError =>
  createTuskError(
    "MIGRATION_FILE_INVALID",
    `Invalid migration file: ${filename}. ${reason}`,
    cause,
    { filename, reason }
  );

export const createMigrationExecutionError = (filename: string, cause?: Error): TuskError =>
  createTuskError(
    "MIGRATION_EXECUTION_FAILED",
    `Migration failed: ${filename}. This migration was rolled back. Fix the SQL and run 'tusk up' again.`,
    cause,
    { filename }
  );

export const createMigrationLockedError = (
  message: string,
  context?: StructuredContext
): TuskError => createTuskError("MIGRATION_LOCKED", message, undefined, context);

export const createBaselineUnsupportedError = (
  message: string,
  context?: StructuredContext
): TuskError => createTuskError("BASELINE_UNSUPPORTED", message, undefined, context);

export const createMetadataTableError = (
  message: string,
  context?: StructuredContext
): TuskError =>
  createTuskError("METADATA_TABLE_INVALID", message, undefined, context);

export const createRollbackError = (filename: string, cause?: Error): TuskError =>
  createTuskError(
    "ROLLBACK_FAILED",
    `Rollback failed: ${filename}. Fix the SQL and run 'tusk down' again.`,
    cause,
    { filename }
  );

export const createValidationError = (message: string, context?: StructuredContext): TuskError =>
  createTuskError("VALIDATION_ERROR", message, undefined, context);

export const createConfigurationError = (message: string, context?: StructuredContext): TuskError =>
  createTuskError("CONFIGURATION_ERROR", message, undefined, context);

export const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const formatTuskError = (error: TuskError): string => {
  let message = `[${error.code}] ${error.message}`;

  if (error.cause) {
    message += `\nCause: ${error.cause.message}`;
  }

  if (error.context && Object.keys(error.context).length > 0) {
    message += `\nContext: ${JSON.stringify(error.context, null, 2)}`;
  }

  return message;
};

export const isTuskError = (error: unknown): error is TuskError => {
  return error instanceof TuskError;
};

export const isDriverNotFoundError = (error: unknown): error is TuskError =>
  error instanceof TuskError && error.code === "DRIVER_NOT_FOUND";
