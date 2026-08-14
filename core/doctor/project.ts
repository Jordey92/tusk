import { access } from "fs/promises";
import { resolve } from "path";
import type { DoctorCheck, DoctorCheckStatus } from "../../types/doctor.js";
import {
  validateMigrations,
  type ValidationResult,
} from "../validate-migrations.js";
import { addCheck, formatError } from "./summary.js";
import type { MigrationsPathState } from "./types.js";

const isResolvedTuskVersion = (tuskVersion: string) => {
  const normalizedVersion = tuskVersion.trim().toLowerCase();
  return normalizedVersion !== "" && normalizedVersion !== "unknown";
};

export const checkTuskVersion = (checks: DoctorCheck[], tuskVersion: string) => {
  const resolved = isResolvedTuskVersion(tuskVersion);

  addCheck(checks, {
    id: "tusk.version",
    status: resolved ? "pass" : "warn",
    message: resolved
      ? `Tusk version resolved: ${tuskVersion}`
      : "Tusk version could not be resolved",
  });
};

export const checkMigrationsPath = async (
  checks: DoctorCheck[],
  migrationsPath: string
): Promise<MigrationsPathState> => {
  const absolutePath = resolve(migrationsPath);

  try {
    await access(absolutePath);
    addCheck(checks, {
      id: "migrations.path",
      status: "pass",
      message: `Migrations path exists: ${migrationsPath}`,
      context: { path: absolutePath },
    });
    return { state: "exists", path: absolutePath };
  } catch (error) {
    addCheck(checks, {
      id: "migrations.path",
      status: "fail",
      message: `Migrations path does not exist: ${migrationsPath}. Run \`tusk init\` to create a migrations directory.`,
      context: {
        path: absolutePath,
        cause: formatError(error),
      },
    });
    return { state: "missing", path: absolutePath };
  }
};

export const validationStatus = (
  result: ValidationResult
): DoctorCheckStatus => {
  if (result.summary.errors > 0) return "fail";
  if (result.summary.warnings > 0) return "warn";
  return "pass";
};

export const checkMigrationFiles = async (
  checks: DoctorCheck[],
  migrationsPath: string
) => {
  const result = await validateMigrations(migrationsPath);
  const status = result.summary.files === 0 ? "warn" : validationStatus(result);

  addCheck(checks, {
    id: "migrations.valid",
    status,
    message:
      result.summary.files === 0
        ? "No migration files found yet. Add an .up.sql and .down.sql migration pair before running `tusk up`."
        : status === "pass"
          ? `Migration files are valid (${result.summary.files} file(s))`
          : `Migration validation found ${result.summary.errors} error(s) and ${result.summary.warnings} warning(s)`,
    context: {
      errors: result.summary.errors,
      warnings: result.summary.warnings,
      files: result.summary.files,
    },
  });

  return result;
};
