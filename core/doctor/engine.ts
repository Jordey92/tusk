import type {
  DatabaseAdapter,
  QueryResultRow,
} from "../../types/migrations.js";
import type {
  DoctorCheck,
  DoctorDatabaseEngine,
} from "../../types/doctor.js";
import { addCheck } from "./summary.js";

interface ServerVersionRow extends QueryResultRow {
  server_version: string | null;
  server_version_num: string | null;
}

interface AuroraVersionRow extends QueryResultRow {
  aurora_version: string | null;
}

interface VersionRow extends QueryResultRow {
  version: string;
}

interface DatabaseEngineInfo {
  engine: string;
  provider: "postgresql" | "aurora-postgresql" | "redshift" | "unknown";
  serverVersion?: string;
  majorVersion?: number;
  rawVersion: string;
}

export const SUPPORTED_POSTGRES_MAJOR = 13;

export const parseMajorVersion = (
  serverVersion: string | null | undefined,
  serverVersionNum: string | null | undefined
) => {
  if (serverVersionNum && /^\d+$/.test(serverVersionNum)) {
    return Math.floor(Number(serverVersionNum) / 10000);
  }

  const match = serverVersion?.match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
};

export const parseMajorVersionFromRawVersion = (rawVersion: string) => {
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

export const inspectDatabaseEngine = async (
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
    serverVersion: auroraVersion
      ? `${serverVersion ?? "unknown"} (Aurora ${auroraVersion})`
      : serverVersion,
    majorVersion,
    rawVersion,
  };
};

export const checkDatabaseEngine = (
  checks: DoctorCheck[],
  engineInfo: DatabaseEngineInfo
): DoctorDatabaseEngine => {
  if (engineInfo.provider === "redshift") {
    addCheck(checks, {
      id: "database.engine",
      status: "fail",
      message:
        "Amazon Redshift is PostgreSQL-like but not a supported Tusk target",
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

  const postgresVersionState =
    engineInfo.majorVersion >= SUPPORTED_POSTGRES_MAJOR
      ? "supported"
      : "below_supported_floor";

  addCheck(checks, {
    id: "database.version",
    status: postgresVersionState === "supported" ? "pass" : "fail",
    message:
      postgresVersionState === "supported"
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
