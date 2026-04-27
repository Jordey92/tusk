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
  DoctorReport,
  DoctorSummary,
} from "../types/doctor.js";
import { readMigrations } from "./read-migrations.js";
import {
  getExecutedMigrationRecordsReadOnly,
  getMigrationTableStateReadOnly,
} from "./migration-records.js";
import { validateMigrations, type ValidationResult } from "./validate-migrations.js";

type DoctorDatabaseInput =
  | {
      configured: false;
      error?: unknown;
    }
  | {
      configured: true;
      adapter: DatabaseAdapter;
    }
  | {
      configured: true;
      error: unknown;
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
  provider: string;
  serverVersion?: string;
  majorVersion?: number;
  supported: boolean;
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

const checkTuskVersion = (checks: DoctorCheck[], tuskVersion: string) => {
  addCheck(checks, {
    id: "tusk.version",
    status: tuskVersion ? "pass" : "warn",
    message: tuskVersion
      ? `Tusk version resolved: ${tuskVersion}`
      : "Tusk version could not be resolved",
  });
};

const checkMigrationsPath = async (
  checks: DoctorCheck[],
  migrationsPath: string
) => {
  const absolutePath = resolve(migrationsPath);

  try {
    await access(absolutePath);
    addCheck(checks, {
      id: "migrations.path",
      status: "pass",
      message: `Migrations path exists: ${migrationsPath}`,
      context: { path: absolutePath },
    });
  } catch (error) {
    addCheck(checks, {
      id: "migrations.path",
      status: "fail",
      message: `Migrations path does not exist: ${migrationsPath}`,
      context: {
        path: absolutePath,
        cause: formatError(error),
      },
    });
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
  const status = validationStatus(result);

  addCheck(checks, {
    id: "migrations.valid",
    status,
    message: status === "pass"
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
      supported: false,
      rawVersion,
    };
  }

  if (!normalizedVersion.startsWith("postgresql")) {
    return {
      engine: "unknown",
      provider: "unknown",
      supported: false,
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
    supported: majorVersion !== undefined && majorVersion >= SUPPORTED_POSTGRES_MAJOR,
    rawVersion,
  };
};

const checkDatabaseEngine = (
  checks: DoctorCheck[],
  database: DoctorDatabase,
  engineInfo: DatabaseEngineInfo
) => {
  database.engine = engineInfo.engine;
  database.provider = engineInfo.provider;
  database.serverVersion = engineInfo.serverVersion;
  database.supported = engineInfo.supported;

  if (engineInfo.provider === "redshift") {
    addCheck(checks, {
      id: "database.engine",
      status: "fail",
      message: "Amazon Redshift is PostgreSQL-like but not a supported Tusk target",
      context: { version: engineInfo.rawVersion },
    });
    return;
  }

  if (engineInfo.provider === "unknown") {
    addCheck(checks, {
      id: "database.engine",
      status: "fail",
      message: "Database engine is not a supported PostgreSQL target",
      context: { version: engineInfo.rawVersion },
    });
    return;
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
    return;
  }

  addCheck(checks, {
    id: "database.version",
    status: engineInfo.supported ? "pass" : "fail",
    message: engineInfo.supported
      ? `PostgreSQL version is supported: ${engineInfo.serverVersion}`
      : `PostgreSQL ${engineInfo.majorVersion} is below Tusk's supported floor (${SUPPORTED_POSTGRES_MAJOR})`,
  });
};

const checkMigrationTable = async (
  checks: DoctorCheck[],
  database: DoctorDatabase,
  adapter: DatabaseAdapter
) => {
  let tableState;

  try {
    tableState = await getMigrationTableStateReadOnly(adapter);
    database.migrationTable = tableState;
  } catch (error) {
    addCheck(checks, {
      id: "database.migrationTable",
      status: "fail",
      message: "_migrations table state could not be read",
      context: { cause: formatError(error) },
    });
    return;
  }

  addCheck(checks, {
    id: "database.migrationTable",
    status: tableState.exists ? "pass" : "warn",
    message: tableState.exists
      ? "_migrations table is readable"
      : "_migrations table was not found; run tusk init or tusk up before applying tracked migrations",
  });

  addCheck(checks, {
    id: "database.checksumMetadata",
    status: !tableState.exists || tableState.hasChecksum ? "pass" : "warn",
    message: tableState.hasChecksum
      ? "Migration checksums are enabled"
      : tableState.exists
        ? "_migrations exists without checksum metadata; legacy records can be read but drift checks are limited"
        : "Checksum metadata will be created when Tusk initializes migration state",
  });
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
    },
  });
};

const checkDatabaseStatus = async (
  checks: DoctorCheck[],
  database: DoctorDatabase,
  migrationsPath: string,
  adapter: DatabaseAdapter
) => {
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

    database.status = { executed, pending };
    addCheck(checks, {
      id: "database.status",
      status: "pass",
      message: `Migration status is readable: ${executed} executed, ${pending} pending`,
      context: { executed, pending },
    });
  } catch (error) {
    addCheck(checks, {
      id: "database.status",
      status: "warn",
      message: "Migration status could not be computed",
      context: { cause: formatError(error) },
    });
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
  database: DoctorDatabase,
  migrationsPath: string,
  input: DoctorDatabaseInput
) => {
  if (!input.configured) {
    addCheck(checks, {
      id: "database.config",
      status: "fail",
      message: "Database configuration was not found",
      context: input.error ? { cause: formatError(input.error) } : undefined,
    });
    return;
  }

  addCheck(checks, {
    id: "database.config",
    status: "pass",
    message: "Database configuration found",
  });

  if ("error" in input) {
    addCheck(checks, {
      id: "database.connection",
      status: "fail",
      message: "Database connection failed",
      context: { cause: formatError(input.error) },
    });
    return;
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
    return;
  }

  database.connected = true;
  addCheck(checks, {
    id: "database.connection",
    status: "pass",
    message: "Database connection works",
  });

  checkDatabaseEngine(checks, database, engineInfo);
  if (!engineInfo.supported) {
    return;
  }

  await checkMigrationTable(checks, database, input.adapter);
  await checkDatabaseDrift(checks, migrationsPath, input.adapter);
  await checkDatabaseStatus(checks, database, migrationsPath, input.adapter);
  await checkAdvisoryLock(checks, input.adapter);
};

export const runDoctor = async (
  options: RunDoctorOptions
): Promise<DoctorReport> => {
  const checks: DoctorCheck[] = [];
  const database: DoctorDatabase = {
    configured: options.database.configured,
    connected: false,
  };

  checkTuskVersion(checks, options.tuskVersion);
  await checkMigrationsPath(checks, options.migrationsPath);
  await checkMigrationFiles(checks, options.migrationsPath);
  await checkDatabase(checks, database, options.migrationsPath, options.database);

  const summary = createSummary(checks);

  return {
    ok: summary.errors === 0,
    summary,
    environment: {
      tuskVersion: options.tuskVersion,
      migrationsPath: options.migrationsPath,
      databaseConfigured: options.database.configured,
    },
    database,
    checks,
  };
};
