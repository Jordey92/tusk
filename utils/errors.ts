export type TuskErrorCode =
  | "DATABASE_CONNECTION_FAILED"
  | "MIGRATION_DIRECTORY_NOT_FOUND"
  | "MIGRATION_FILE_INVALID"
  | "MIGRATION_EXECUTION_FAILED"
  | "ROLLBACK_FAILED"
  | "VALIDATION_ERROR"
  | "CONFIGURATION_ERROR";

export interface TuskError {
  code: TuskErrorCode;
  message: string;
  cause?: Error;
  context?: Record<string, any>;
}

export const createTuskError = (
  code: TuskErrorCode,
  message: string,
  cause?: Error,
  context?: Record<string, any>
): TuskError => ({
  code,
  message,
  cause,
  context,
});

export const createDatabaseError = (message: string, cause?: Error, context?: Record<string, any>): TuskError =>
  createTuskError("DATABASE_CONNECTION_FAILED", message, cause, context);

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
    `Migration failed: ${filename}. This migration was rolled back. Fix the SQL and run 'migrate up' again.`,
    cause,
    { filename }
  );

export const createRollbackError = (filename: string, cause?: Error): TuskError =>
  createTuskError(
    "ROLLBACK_FAILED",
    `Rollback failed: ${filename}. Fix the SQL and run 'migrate down' again.`,
    cause,
    { filename }
  );

export const createValidationError = (message: string, context?: Record<string, any>): TuskError =>
  createTuskError("VALIDATION_ERROR", message, undefined, context);

export const createConfigurationError = (message: string, context?: Record<string, any>): TuskError =>
  createTuskError("CONFIGURATION_ERROR", message, undefined, context);

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

export const isTuskError = (error: any): error is TuskError => {
  return error && typeof error === 'object' && 'code' in error && 'message' in error;
};