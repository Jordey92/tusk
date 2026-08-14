import type { DatabaseAdapter } from "../../types/migrations.js";
import type {
  DoctorCheck,
  DoctorMigrationStatus,
  DoctorMigrationTable,
} from "../../types/doctor.js";
import { readMigrations } from "../read-migrations.js";
import {
  formatMigrationTableShapeIssues,
  getExecutedMigrationRecordsReadOnly,
  getMigrationTableStateReadOnly,
} from "../migration-records.js";
import { validateMigrations, type ValidationResult } from "../validate-migrations.js";
import { addCheck, formatError } from "./summary.js";
import { validationStatus } from "./project.js";

type MigrationTableTrust =
  | {
      state: "trustworthy";
      table: DoctorMigrationTable;
    }
  | {
      state: "blocked";
      table?: DoctorMigrationTable;
    };

const toDoctorMigrationTable = (
  tableState: Awaited<ReturnType<typeof getMigrationTableStateReadOnly>>
): DoctorMigrationTable => {
  if (tableState.state === "missing") {
    return { state: "missing" };
  }

  if (tableState.state === "ready") {
    return { state: "ready", checksumState: "enabled" };
  }

  if (tableState.state === "legacy_missing_checksum_column") {
    return {
      state: "legacy_missing_checksum_column",
      checksumState: "limited",
    };
  }

  return {
    state: "invalid_shape",
    issues: tableState.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      column: issue.column,
      expected: issue.expected,
      actual: issue.actual,
    })),
  };
};

export const checkMigrationTable = async (
  checks: DoctorCheck[],
  adapter: DatabaseAdapter
): Promise<MigrationTableTrust> => {
  let tableState;

  try {
    tableState = await getMigrationTableStateReadOnly(adapter);
  } catch (error) {
    addCheck(checks, {
      id: "database.migrationTable",
      status: "fail",
      message: "_migrations table state could not be read",
      context: { cause: formatError(error) },
    });
    return { state: "blocked" };
  }

  const table = toDoctorMigrationTable(tableState);

  if (tableState.state === "invalid_shape") {
    addCheck(checks, {
      id: "database.migrationTable",
      status: "fail",
      message: "_migrations table has an invalid shape",
      context: {
        issues: tableState.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          column: issue.column,
          expected: issue.expected,
          actual: issue.actual,
        })),
        details: formatMigrationTableShapeIssues(tableState.issues),
      },
    });
    return { state: "blocked", table };
  }

  addCheck(checks, {
    id: "database.migrationTable",
    status: tableState.state === "missing" ? "warn" : "pass",
    message:
      tableState.state === "missing"
        ? "_migrations table was not found. Run `tusk up` to initialise migration tracking when applying migrations."
        : "_migrations table is readable",
  });

  addCheck(checks, {
    id: "database.checksumMetadata",
    status:
      tableState.state === "legacy_missing_checksum_column" ? "warn" : "pass",
    message:
      tableState.state === "ready"
        ? "Migration checksums are enabled"
        : tableState.state === "legacy_missing_checksum_column"
          ? "_migrations exists without checksum metadata; legacy records can be read but drift checks are limited"
          : "Checksum metadata will be created when Tusk initializes migration state",
  });

  return { state: "trustworthy", table };
};

export const checkDatabaseDrift = async (
  checks: DoctorCheck[],
  migrationsPath: string,
  adapter: DatabaseAdapter
) => {
  const result = await validateMigrations(migrationsPath, {
    adapter,
    checkDatabase: true,
  });
  const status = validationStatus(result);

  addCheck(checks, {
    id: "database.drift",
    status,
    message:
      status === "pass"
        ? "No checksum drift detected"
        : `Database validation found ${result.summary.errors} error(s) and ${result.summary.warnings} warning(s)`,
    context: {
      errors: result.summary.errors,
      warnings: result.summary.warnings,
      issues: result.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        filename: issue.filename,
      })),
    },
  });

  return result;
};

export const skipDatabaseStatusAfterDriftFailure = (
  checks: DoctorCheck[],
  result: ValidationResult
): DoctorMigrationStatus => {
  addCheck(checks, {
    id: "database.status",
    status: "skip",
    message:
      "Migration status skipped because database validation found unsafe migration state",
    context: {
      errors: result.summary.errors,
      warnings: result.summary.warnings,
      issues: result.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        filename: issue.filename,
      })),
    },
  });

  return {
    state: "skipped",
    reason: "unsafe_migration_state",
  };
};

export const checkDatabaseStatus = async (
  checks: DoctorCheck[],
  migrationsPath: string,
  adapter: DatabaseAdapter
): Promise<DoctorMigrationStatus> => {
  try {
    const migrations = await readMigrations(migrationsPath, "up");
    const executedRecords = await getExecutedMigrationRecordsReadOnly(adapter);
    const executedFilenames = new Set(
      executedRecords.map((record) => record.filename)
    );
    const executed = migrations.filter((migration) =>
      executedFilenames.has(migration.filename)
    ).length;
    const pending = migrations.length - executed;

    addCheck(checks, {
      id: "database.status",
      status: "pass",
      message: `Migration status is readable: ${executed} executed, ${pending} pending`,
      context: { executed, pending },
    });
    return { state: "readable", executed, pending };
  } catch (error) {
    addCheck(checks, {
      id: "database.status",
      status: "warn",
      message: "Migration status could not be computed",
      context: { cause: formatError(error) },
    });
    return {
      state: "unreadable",
      cause: formatError(error),
    };
  }
};

export const checkAdvisoryLock = async (
  checks: DoctorCheck[],
  adapter: DatabaseAdapter
) => {
  try {
    await adapter.acquireMigrationLock();
  } catch (error) {
    addCheck(checks, {
      id: "database.advisoryLock",
      status: "warn",
      message: "Advisory migration lock could not be acquired",
      context: { cause: formatError(error) },
    });
    return;
  }

  try {
    await adapter.releaseMigrationLock();
    addCheck(checks, {
      id: "database.advisoryLock",
      status: "pass",
      message: "Advisory migration lock can be acquired and released",
    });
  } catch (error) {
    addCheck(checks, {
      id: "database.advisoryLock",
      status: "warn",
      message: "Advisory migration lock could not be released",
      context: { cause: formatError(error) },
    });
  }
};
