import type { DoctorCheck, DoctorDatabase } from "../../types/doctor.js";
import { addCheck, formatError } from "./summary.js";
import { checkDatabaseEngine, inspectDatabaseEngine } from "./engine.js";
import {
  checkAdvisoryLock,
  checkDatabaseDrift,
  checkDatabaseStatus,
  checkMigrationTable,
  skipDatabaseStatusAfterDriftFailure,
} from "./migration-state.js";
import { validationStatus } from "./project.js";
import type { DoctorDatabaseInput, MigrationsPathState } from "./types.js";

export const checkDatabase = async (
  checks: DoctorCheck[],
  migrationsPath: string,
  migrationsPathState: MigrationsPathState,
  input: DoctorDatabaseInput
): Promise<DoctorDatabase> => {
  if (input.state === "driver_missing") {
    addCheck(checks, {
      id: "database.driver",
      status: "fail",
      message: formatError(input.error),
    });
    return {
      state: "driver_missing",
      configuration: input.configuration,
    };
  }

  if (input.state === "not_configured") {
    addCheck(checks, {
      id: "database.config",
      status: "fail",
      message: "Database configuration was not found",
      context: input.error ? { cause: formatError(input.error) } : undefined,
    });
    return { state: "not_configured" };
  }

  addCheck(checks, {
    id: "database.config",
    status: "pass",
    message: "Database configuration found",
  });

  if (input.state === "connection_failed") {
    addCheck(checks, {
      id: "database.connection",
      status: "fail",
      message: "Database connection failed",
      context: { cause: formatError(input.error) },
    });
    return {
      state: "connection_failed",
      configuration: "found",
    };
  }

  let engineInfo;

  try {
    engineInfo = await inspectDatabaseEngine(input.adapter);
  } catch (error) {
    addCheck(checks, {
      id: "database.connection",
      status: "fail",
      message: "Database connection failed",
      context: { cause: formatError(error) },
    });
    return {
      state: "connection_failed",
      configuration: "found",
    };
  }

  addCheck(checks, {
    id: "database.connection",
    status: "pass",
    message: "Database connection works",
  });

  const engine = checkDatabaseEngine(checks, engineInfo);
  const connectedDatabase: Extract<DoctorDatabase, { state: "connected" }> = {
    state: "connected",
    engine,
  };
  if (engine.state === "unsupported") {
    return connectedDatabase;
  }

  const migrationTableTrust = await checkMigrationTable(checks, input.adapter);
  if (migrationTableTrust.table) {
    connectedDatabase.migrationTable = migrationTableTrust.table;
  }

  if (
    migrationTableTrust.state === "trustworthy" &&
    migrationsPathState.state === "exists"
  ) {
    const driftResult = await checkDatabaseDrift(
      checks,
      migrationsPath,
      input.adapter
    );
    if (validationStatus(driftResult) === "fail") {
      connectedDatabase.migrationStatus = skipDatabaseStatusAfterDriftFailure(
        checks,
        driftResult
      );
    } else {
      connectedDatabase.migrationStatus = await checkDatabaseStatus(
        checks,
        migrationsPath,
        input.adapter
      );
    }
  } else if (
    migrationTableTrust.state === "trustworthy" &&
    migrationsPathState.state === "missing"
  ) {
    connectedDatabase.migrationStatus = {
      state: "skipped",
      reason: "missing_migrations_path",
    };
  }
  await checkAdvisoryLock(checks, input.adapter);

  return connectedDatabase;
};
