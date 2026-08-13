import type { DoctorCheck, DoctorReport } from "../types/doctor.js";
import { checkDatabase } from "./doctor/database.js";
import {
  checkMigrationFiles,
  checkMigrationsPath,
  checkTuskVersion,
} from "./doctor/project.js";
import {
  createSummary,
  getDatabaseConfiguration,
  getDoctorResult,
} from "./doctor/summary.js";
import type { RunDoctorOptions } from "./doctor/types.js";

export const runDoctor = async (
  options: RunDoctorOptions
): Promise<DoctorReport> => {
  const checks: DoctorCheck[] = [];

  checkTuskVersion(checks, options.tuskVersion);
  const migrationsPathState = await checkMigrationsPath(
    checks,
    options.migrationsPath
  );
  if (migrationsPathState.state === "exists") {
    await checkMigrationFiles(checks, options.migrationsPath);
  }
  const database = await checkDatabase(
    checks,
    options.migrationsPath,
    migrationsPathState,
    options.database
  );

  const summary = createSummary(checks);

  return {
    result: getDoctorResult(summary),
    summary,
    environment: {
      tuskVersion: options.tuskVersion,
      migrationsPath: options.migrationsPath,
      databaseConfiguration: getDatabaseConfiguration(options.database),
    },
    database,
    checks,
  };
};
