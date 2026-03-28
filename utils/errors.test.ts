import { describe, expect, test } from "bun:test";
import {
  createTuskError,
  createDatabaseError,
  createMigrationDirectoryError,
  createMigrationFileError,
  createMigrationExecutionError,
  createRollbackError,
  createValidationError,
  createConfigurationError,
  formatTuskError,
  isTuskError,
  type TuskError,
} from "./errors";

describe("Error Utilities", () => {
  describe("createTuskError", () => {
    test("should create error with all fields", () => {
      const cause = new Error("Original error");
      const context = { filename: "test.sql", line: 42 };

      const error = createTuskError(
        "MIGRATION_EXECUTION_FAILED",
        "Migration failed",
        cause,
        context
      );

      expect(error.code).toBe("MIGRATION_EXECUTION_FAILED");
      expect(error.message).toBe("Migration failed");
      expect(error.cause).toBe(cause);
      expect(error.context).toEqual(context);
    });

    test("should create error without optional fields", () => {
      const error = createTuskError("VALIDATION_ERROR", "Validation failed");

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe("Validation failed");
      expect(error.cause).toBeUndefined();
      expect(error.context).toBeUndefined();
    });
  });

  describe("createDatabaseError", () => {
    test("should create database connection error", () => {
      const cause = new Error("Connection timeout");
      const error = createDatabaseError("Failed to connect", cause, { host: "localhost" });

      expect(error.code).toBe("DATABASE_CONNECTION_FAILED");
      expect(error.message).toBe("Failed to connect");
      expect(error.cause).toBe(cause);
      expect(error.context).toEqual({ host: "localhost" });
    });

    test("should create database error without cause", () => {
      const error = createDatabaseError("Connection failed");

      expect(error.code).toBe("DATABASE_CONNECTION_FAILED");
      expect(error.message).toBe("Connection failed");
      expect(error.cause).toBeUndefined();
    });
  });

  describe("createMigrationDirectoryError", () => {
    test("should create migration directory error with path", () => {
      const error = createMigrationDirectoryError("/path/to/migrations");

      expect(error.code).toBe("MIGRATION_DIRECTORY_NOT_FOUND");
      expect(error.message).toContain("/path/to/migrations");
      expect(error.message).toContain("MIGRATIONS_PATH");
      expect(error.context).toEqual({ path: "/path/to/migrations" });
    });

    test("should include cause if provided", () => {
      const cause = new Error("ENOENT");
      const error = createMigrationDirectoryError("/missing/dir", cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe("createMigrationFileError", () => {
    test("should create migration file error with reason", () => {
      const error = createMigrationFileError(
        "001_init.up.sql",
        "Invalid SQL syntax"
      );

      expect(error.code).toBe("MIGRATION_FILE_INVALID");
      expect(error.message).toContain("001_init.up.sql");
      expect(error.message).toContain("Invalid SQL syntax");
      expect(error.context).toEqual({
        filename: "001_init.up.sql",
        reason: "Invalid SQL syntax",
      });
    });

    test("should include cause if provided", () => {
      const cause = new Error("Parse error");
      const error = createMigrationFileError("test.sql", "Bad syntax", cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe("createMigrationExecutionError", () => {
    test("should create migration execution error", () => {
      const error = createMigrationExecutionError("002_users.up.sql");

      expect(error.code).toBe("MIGRATION_EXECUTION_FAILED");
      expect(error.message).toContain("002_users.up.sql");
      expect(error.message).toContain("rolled back");
      expect(error.message).toContain("tusk up");
      expect(error.context).toEqual({ filename: "002_users.up.sql" });
    });

    test("should include cause if provided", () => {
      const cause = new Error("Column already exists");
      const error = createMigrationExecutionError("test.sql", cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe("createRollbackError", () => {
    test("should create rollback error", () => {
      const error = createRollbackError("003_posts.down.sql");

      expect(error.code).toBe("ROLLBACK_FAILED");
      expect(error.message).toContain("003_posts.down.sql");
      expect(error.message).toContain("tusk down");
      expect(error.context).toEqual({ filename: "003_posts.down.sql" });
    });

    test("should include cause if provided", () => {
      const cause = new Error("Table does not exist");
      const error = createRollbackError("test.sql", cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe("createValidationError", () => {
    test("should create validation error", () => {
      const context = { field: "email", value: "invalid" };
      const error = createValidationError("Email format invalid", context);

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe("Email format invalid");
      expect(error.context).toEqual(context);
    });

    test("should work without context", () => {
      const error = createValidationError("Validation failed");

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.context).toBeUndefined();
    });
  });

  describe("createConfigurationError", () => {
    test("should create configuration error", () => {
      const context = { env: "DATABASE_URL", provided: false };
      const error = createConfigurationError("Missing DATABASE_URL", context);

      expect(error.code).toBe("CONFIGURATION_ERROR");
      expect(error.message).toBe("Missing DATABASE_URL");
      expect(error.context).toEqual(context);
    });

    test("should work without context", () => {
      const error = createConfigurationError("Invalid config");

      expect(error.code).toBe("CONFIGURATION_ERROR");
      expect(error.context).toBeUndefined();
    });
  });

  describe("formatTuskError", () => {
    test("should format error with code and message", () => {
      const error = createTuskError("VALIDATION_ERROR", "Field is required");
      const formatted = formatTuskError(error);

      expect(formatted).toContain("[VALIDATION_ERROR]");
      expect(formatted).toContain("Field is required");
    });

    test("should include cause in formatted output", () => {
      const cause = new Error("Database timeout");
      const error = createDatabaseError("Connection failed", cause);
      const formatted = formatTuskError(error);

      expect(formatted).toContain("[DATABASE_CONNECTION_FAILED]");
      expect(formatted).toContain("Connection failed");
      expect(formatted).toContain("Cause: Database timeout");
    });

    test("should include context in formatted output", () => {
      const error = createMigrationFileError("test.sql", "Invalid syntax");
      const formatted = formatTuskError(error);

      expect(formatted).toContain("[MIGRATION_FILE_INVALID]");
      expect(formatted).toContain("Context:");
      expect(formatted).toContain("test.sql");
      expect(formatted).toContain("Invalid syntax");
    });

    test("should format error with cause and context", () => {
      const cause = new Error("Parse error");
      const context = { line: 42, column: 10 };
      const error = createTuskError(
        "MIGRATION_FILE_INVALID",
        "Syntax error",
        cause,
        context
      );
      const formatted = formatTuskError(error);

      expect(formatted).toContain("[MIGRATION_FILE_INVALID]");
      expect(formatted).toContain("Syntax error");
      expect(formatted).toContain("Cause: Parse error");
      expect(formatted).toContain("Context:");
      expect(formatted).toContain('"line": 42');
      expect(formatted).toContain('"column": 10');
    });

    test("should not include empty context", () => {
      const error = createTuskError("VALIDATION_ERROR", "Failed", undefined, {});
      const formatted = formatTuskError(error);

      expect(formatted).not.toContain("Context:");
    });
  });

  describe("isTuskError", () => {
    test("should return true for valid TuskError", () => {
      const error = createTuskError("VALIDATION_ERROR", "Test error");

      expect(isTuskError(error)).toBe(true);
    });

    test("should return true for all TuskError types", () => {
      const errors: TuskError[] = [
        createDatabaseError("test"),
        createMigrationDirectoryError("/path"),
        createMigrationFileError("file.sql", "reason"),
        createMigrationExecutionError("exec.sql"),
        createRollbackError("rollback.sql"),
        createValidationError("validation"),
        createConfigurationError("config"),
      ];

      errors.forEach((error) => {
        expect(isTuskError(error)).toBe(true);
      });
    });

    test("should return false for regular Error", () => {
      const error = new Error("Regular error");

      expect(isTuskError(error)).toBe(false);
    });

    test("should return false for null", () => {
      expect(isTuskError(null)).toBe(false);
    });

    test("should return false for undefined", () => {
      expect(isTuskError(undefined)).toBe(false);
    });

    test("should return false for objects without code or message", () => {
      expect(isTuskError({ code: "TEST" })).toBe(false);
      expect(isTuskError({ message: "test" })).toBe(false);
      expect(isTuskError({ random: "object" })).toBe(false);
    });

    test("should return false for primitives", () => {
      expect(isTuskError("string")).toBe(false);
      expect(isTuskError(123)).toBe(false);
      expect(isTuskError(true)).toBe(false);
    });
  });
});
