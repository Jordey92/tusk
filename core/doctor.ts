import { access } from "fs/promises";
import { resolve } from "path";
import type {
  DatabaseAdapter,
  QueryResultRow,
} from "../types/migrations.js";
import type {
  DoctorCheck,
  DoctorCheckStatus,
  DoctorDatabase,
  DoctorDatabaseConfiguration,
  DoctorDatabaseEngine,
  DoctorMigrationStatus,
  DoctorMigrationTable,
  DoctorReport,
  DoctorSummary,
} from "../types/doctor.js";
import { readMigrations } from "./read-migrations.js";
import {
  formatMigrationTableShapeIssues,
  getExecutedMigrationRecordsReadOnly,
  getMigrationTableStateReadOnly,
} from "./migration-records.js";
import { validateMigrations, type ValidationResult } from "./validate-migrations.js";

type DoctorDatabaseInput =
  | {
      state: "not_configured";
      error?: unknown;
    }
  | {
      state: "configured";
      adapter: DatabaseAdapter;
    }
  | {
      state: "connection_failed";
      error: unknown;
    }
  | {
      state: "driver_missing";
      configuration: DoctorDatabaseConfiguration;
      error: unknown;
    };

type MigrationsPathState =
  | {
      state: "exists";
      path: string;
    }
  | {
      state: "missing";
      path: string;
    };

type MigrationTableTrust =
  | {
      state: "trustworthy";
      table: DoctorMigrationTable;
    }
  | {
      state: "blocked";
      table?: DoctorMigrationTable;
    };

interface RunDoctorOptions {
  migrationsPath: string;
  tuskVersion: string;
  database: DoctorDatabaseInput;
}

interface VersionRow extends QueryResultRow {
  version: string;
}

interface ServerVersionRow extends QueryResultRow {
  server_version: string | null;
  server_version_num: string | null;
}

interface AuroraVersionRow extends QueryResultRow {
  aurora_version: string | null;
}

interface DatabaseEngineInfo {
  engine: string;
  provider: "postgresql" | "aurora-postgresql" | "redshift" | "unknown";
  serverVersion?: string;
  majorVersion?: number;
  rawVersion: string;
}

const SUPPORTED_POSTGRES_MAJOR = 13;

const statusCounts: Record<DoctorCheckStatus, keyof DoctorSummary> = {
  pass: "passed",
  warn: "warnings",
  fail: "errors",
  skip: "skipped",
};

const createSummary = (checks: DoctorCheck[]): DoctorSummary => {
  const summary: DoctorSummary = {
    passed: 0,
    warnings: 0,
    errors: 0,
    skipped: 0,
  };

  for (const check of checks) {
    summary[statusCounts[check.status]]++;
  }

  return summary;
};

const addCheck = (checks: DoctorCheck[], check: DoctorCheck) => {
  checks.push(check);
};

const formatError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const getDoctorResult = (summary: DoctorSummary) =>
  summary.errors === 0 ? "pass" : "fail";

const getDatabaseConfiguration = (
  input: DoctorDatabaseInput
): DoctorDatabaseConfiguration => {
  if (input.state === "not_configured") {
    return "missing";
  }

  if (input.state === "driver_missing") {
    return input.configuration;
  }

  return "found";
};

const isResolvedTuskVersion = (tuskVersion: string) => {
  const normalizedVersion = tuskVersion.trim().toLowerCase();
  return normalizedVersion !== "" && normalizedVersion !== "unknown";
};

const checkTuskVersion = (checks: DoctorCheck[], tuskVersion: string) => {
  const resolved = isResolvedTuskVersion(tuskVersion);

  addCheck(checks, {
    id: "tusk.version",
    status: resolved ? "pass" : "warn",
    message: resolved
      ? `Tusk version resolved: ${tuskVersion}`
      : "Tusk version could not be resolved",
  });
};

const checkMigrationsPath = async (
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

const validationStatus = (result: ValidationResult): DoctorCheckStatus => {
  if (result.summary.errors > 0) return "fail";
  if (result.summary.warnings > 0) return "warn";
  return "pass";
};

const checkMigrationFiles = async (
  checks: DoctorCheck[],
  migrationsPath: string
) => {
  const result = await validateMigrations(migrationsPath);
  const status = result.summary.files === 0 ? "warn" : validationStatus(result);

  addCheck(checks, {
    id: "migrations.valid",
    status,
    message: result.summary.files === 0
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

const parseMajorVersion = (
  serverVersion: string | null | undefined,
  serverVersionNum: string | null | undefined
) => {
  if (serverVersionNum && /^\d+$/.test(serverVersionNum)) {
    return Math.floor(Number(serverVersionNum) / 10000);
  }

  const match = serverVersion?.match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
};

const parseMajorVersionFromRawVersion = (rawVersion: string) => {
  const match = rawVersion.match(/^PostgreSQL\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
};

const maybeReadPostgresServerVersion = async (adapter: DatabaseAdapter) => {
  try {
    const result = await adapter.query<ServerVersionRow>(`
      SELECT
        current_setting('server_version') AS server_version,
        current_setting('server_version_num') AS server_version_num
    `);
    return {
      serverVersion: result.rows[0]?.server_version ?? undefined,
      serverVersionNum: result.rows[0]?.server_version_num ?? undefined,
    };
  } catch {
    return {
      serverVersion: undefined,
      serverVersionNum: undefined,
    };
  }
};

const maybeReadAuroraVersion = async (adapter: DatabaseAdapter) => {
  try {
    const result = await adapter.query<AuroraVersionRow>(
      "SELECT aurora_version() AS aurora_version"
    );
    return result.rows[0]?.aurora_version ?? undefined;
  } catch {
    return undefined;
  }
};

const inspectDatabaseEngine = async (
  adapter: DatabaseAdapter
): Promise<DatabaseEngineInfo> => {
  const result = await adapter.query<VersionRow>(`
    SELECT version() AS version
  `);
  const row = result.rows[0];
  const rawVersion = row?.version ?? "";
  const normalizedVersion = rawVersion.toLowerCase();

  if (normalizedVersion.includes("redshift")) {
    return {
      engine: "redshift",
      provider: "redshift",
      rawVersion,
    };
  }

  if (!normalizedVersion.startsWith("postgresql")) {
    return {
      engine: "unknown",
      provider: "unknown",
      rawVersion,
    };
  }

  const postgresVersion = await maybeReadPostgresServerVersion(adapter);
  const serverVersion = postgresVersion.serverVersion ?? rawVersion;
  const majorVersion =
    parseMajorVersion(
      postgresVersion.serverVersion,
      postgresVersion.serverVersionNum
    ) ?? parseMajorVersionFromRawVersion(rawVersion);
  const auroraVersion = await maybeReadAuroraVersion(adapter);
  return {
    engine: "postgresql",
    provider: auroraVersion ? "aurora-postgresql" : "postgresql",
    serverVersion: auroraVersion ? `${serverVersion ?? "unknown"} (Aurora ${auroraVersion})` : serverVersion,
    majorVersion,
    rawVersion,
  };
};

const checkDatabaseEngine = (
  checks: DoctorCheck[],
  engineInfo: DatabaseEngineInfo
): DoctorDatabaseEngine => {
  if (engineInfo.provider === "redshift") {
    addCheck(checks, {
      id: "database.engine",
      status: "fail",
      message: "Amazon Redshift is PostgreSQL-like but not a supported Tusk target",
      context: { version: engineInfo.rawVersion },
    });
    return {
      state: "unsupported",
      engine: "postgresql",
      provider: "redshift",
      reason: "unsupported_provider",
      rawVersion: engineInfo.rawVersion,
    };
  }

  if (engineInfo.provider === "unknown") {
    addCheck(checks, {
      id: "database.engine",
      status: "fail",
      message: "Database engine is not a supported PostgreSQL target",
      context: { version: engineInfo.rawVersion },
    });
    return {
      state: "unsupported",
      engine: "postgresql",
      provider: "unknown",
      reason: "unsupported_provider",
      rawVersion: engineInfo.rawVersion,
    };
  }

  addCheck(checks, {
    id: "database.engine",
    status: "pass",
    message: `Database engine detected: ${engineInfo.provider}`,
    context: { version: engineInfo.rawVersion },
  });

  if (engineInfo.majorVersion === undefined) {
    addCheck(checks, {
      id: "database.version",
      status: "fail",
      message: "PostgreSQL major version could not be determined",
    });
    return {
      state: "unsupported",
      engine: "postgresql",
      provider: engineInfo.provider,
      reason: "version_unknown",
      supportedFloor: SUPPORTED_POSTGRES_MAJOR,
      rawVersion: engineInfo.rawVersion,
      serverVersion: engineInfo.serverVersion,
    };
  }

  const postgresVersionState = engineInfo.majorVersion >= SUPPORTED_POSTGRES_MAJOR
    ? "supported"
    : "below_supported_floor";

  addCheck(checks, {
    id: "database.version",
    status: postgresVersionState === "supported" ? "pass" : "fail",
    message: postgresVersionState === "supported"
      ? `PostgreSQL version is supported: ${engineInfo.serverVersion}`
      : `PostgreSQL ${engineInfo.majorVersion} is below Tusk's supported floor (${SUPPORTED_POSTGRES_MAJOR})`,
  });

  if (postgresVersionState === "below_supported_floor") {
    return {
      state: "unsupported",
      engine: "postgresql",
      provider: engineInfo.provider,
      reason: "version_below_floor",
      supportedFloor: SUPPORTED_POSTGRES_MAJOR,
      rawVersion: engineInfo.rawVersion,
      serverVersion: engineInfo.serverVersion,
      majorVersion: engineInfo.majorVersion,
    };
  }

  return {
    state: "supported",
    engine: "postgresql",
    provider: engineInfo.provider,
    serverVersion: engineInfo.serverVersion ?? String(engineInfo.majorVersion),
    majorVersion: engineInfo.majorVersion,
    rawVersion: engineInfo.rawVersion,
  };
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

const checkMigrationTable = async (
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
    message: tableState.state === "missing"
      ? "_migrations table was not found. Run `tusk up` to initialise migration tracking when applying migrations."
      : "_migrations table is readable",
  });

  addCheck(checks, {
    id: "database.checksumMetadata",
    status: tableState.state === "legacy_missing_checksum_column" ? "warn" : "pass",
    message: tableState.state === "ready"
      ? "Migration checksums are enabled"
      : tableState.state === "legacy_missing_checksum_column"
        ? "_migrations exists without checksum metadata; legacy records can be read but drift checks are limited"
        : "Checksum metadata will be created when Tusk initializes migration state",
  });

  return { state: "trustworthy", table };
};

const checkDatabaseDrift = async (
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
    message: status === "pass"
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

const skipDatabaseStatusAfterDriftFailure = (
  checks: DoctorCheck[],
  result: ValidationResult
): DoctorMigrationStatus => {
  addCheck(checks, {
    id: "database.status",
    status: "skip",
    message: "Migration status skipped because database validation found unsafe migration state",
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

const checkDatabaseStatus = async (
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

const checkAdvisoryLock = async (
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

const checkDatabase = async (
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
