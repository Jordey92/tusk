import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DatabaseAdapter, QueryResultRow } from "../types/migrations";
import { calculateChecksum } from "../utils/checksum";
import { createDriverNotFoundError } from "../utils/errors";
import { runDoctor } from "./doctor";

const createTempDir = async () => mkdtemp(join(tmpdir(), "tusk-doctor-"));
const upFilename = "1728123456789_create_widgets.up.sql";
const downFilename = "1728123456789_create_widgets.down.sql";
const upSql = "CREATE TABLE widgets (id INTEGER PRIMARY KEY);";
const downSql = "DROP TABLE IF EXISTS widgets;";

const writeMigrationPair = async (migrationsPath: string) => {
  await writeFile(
    join(migrationsPath, upFilename),
    upSql
  );
  await writeFile(
    join(migrationsPath, downFilename),
    downSql
  );
};

const queryResult = <T extends QueryResultRow>(rows: T[]) => ({
  rows,
  rowCount: rows.length,
});

const createMigrationTableColumns = (hasChecksum = true) => [
  {
    column_name: "id",
    formatted_type: "integer",
    is_not_null: true,
    column_default: "nextval('_migrations_id_seq'::regclass)",
    identity_generation: null,
  },
  {
    column_name: "filename",
    formatted_type: "character varying(255)",
    is_not_null: true,
    column_default: null,
    identity_generation: null,
  },
  {
    column_name: "executed_at",
    formatted_type: "timestamp without time zone",
    is_not_null: false,
    column_default: "now()",
    identity_generation: null,
  },
  ...(hasChecksum
    ? [
        {
          column_name: "checksum",
          formatted_type: "character varying(64)",
          is_not_null: false,
          column_default: null,
          identity_generation: null,
        },
      ]
    : []),
];

const migrationTableConstraints: Array<{
  constraint_type: "p" | "u";
  columns: string[];
}> = [
  { constraint_type: "p", columns: ["id"] },
  { constraint_type: "u", columns: ["filename"] },
];

interface VersionAdapterOptions {
  serverVersion?: string | null;
  serverVersionNum?: string | null;
  migrationTableExists?: boolean;
  hasChecksum?: boolean;
  migrationTableColumns?: ReturnType<typeof createMigrationTableColumns>;
  migrationTableConstraints?: typeof migrationTableConstraints;
  migrationRows?: QueryResultRow[];
  auroraVersion?: string;
}

type DoctorTestAdapter = Pick<
  DatabaseAdapter,
  "query" | "acquireMigrationLock" | "releaseMigrationLock"
>;

const toDatabaseAdapter = (adapter: DoctorTestAdapter): DatabaseAdapter =>
  adapter as DatabaseAdapter;

const createVersionAdapter = (
  version: string,
  options: VersionAdapterOptions = {}
) => toDatabaseAdapter({
  query: async <T extends QueryResultRow = QueryResultRow>(sql: string) => {
    if (sql.includes("aurora_version()")) {
      return queryResult(
        options.auroraVersion
          ? ([{ aurora_version: options.auroraVersion }] as T[])
          : ([] as T[])
      );
    }

    if (sql.includes("version()")) {
      return queryResult([
        {
          version,
        },
      ] as T[]);
    }

    if (sql.includes("current_setting")) {
      return queryResult([
        {
          server_version: options.serverVersion === undefined
            ? "8.0.2"
            : options.serverVersion,
          server_version_num: options.serverVersionNum === undefined
            ? "80002"
            : options.serverVersionNum,
        },
      ] as T[]);
    }

    if (sql.includes("pg_constraint")) {
      return queryResult(
        (options.migrationTableConstraints ?? migrationTableConstraints) as T[]
      );
    }

    if (sql.includes("pg_attribute")) {
      return queryResult(
        (options.migrationTableColumns ??
          createMigrationTableColumns(options.hasChecksum !== false)) as T[]
      );
    }

    if (sql.includes("to_regclass")) {
      return queryResult([
        {
          migration_table: options.migrationTableExists
            ? "_migrations"
            : null,
        },
      ] as T[]);
    }

    if (sql.includes("FROM _migrations")) {
      return queryResult((options.migrationRows ?? []) as T[]);
    }

    return queryResult([] as T[]);
  },
  acquireMigrationLock: async () => {},
  releaseMigrationLock: async () => {},
});

const createHealthyAdapter = () => {
  const lockCalls: string[] = [];

  const adapter: DoctorTestAdapter = {
    query: async <T extends QueryResultRow = QueryResultRow>(sql: string) => {
      if (sql.includes("aurora_version()")) {
        return queryResult([] as T[]);
      }

      if (sql.includes("version()")) {
        return queryResult([
          {
            version: "PostgreSQL 16.9 on arm64-apple-darwin",
          },
        ] as T[]);
      }

      if (sql.includes("current_setting")) {
        return queryResult([
          {
            server_version: "16.9",
            server_version_num: "160009",
          },
        ] as T[]);
      }

      if (sql.includes("pg_constraint")) {
        return queryResult(migrationTableConstraints as T[]);
      }

      if (sql.includes("pg_attribute")) {
        return queryResult(createMigrationTableColumns(true) as T[]);
      }

      if (sql.includes("to_regclass")) {
        return queryResult([{ migration_table: "_migrations" }] as T[]);
      }

      if (sql.includes("FROM _migrations")) {
        return queryResult([
          {
            filename: upFilename,
            checksum: calculateChecksum(upSql),
            executed_at: new Date("2026-01-01T00:00:00.000Z"),
          },
        ] as T[]);
      }

      return queryResult([] as T[]);
    },
    acquireMigrationLock: async () => {
      lockCalls.push("acquire");
    },
    releaseMigrationLock: async () => {
      lockCalls.push("release");
    },
  };

  return { adapter: toDatabaseAdapter(adapter), lockCalls };
};

const checkIds = (report: Awaited<ReturnType<typeof runDoctor>>) =>
  report.checks.map((check) => check.id);

const notConfiguredDatabase = (error?: unknown) =>
  error
    ? { state: "not_configured" as const, error }
    : { state: "not_configured" as const };

const configuredDatabase = (adapter: DatabaseAdapter) => ({
  state: "configured" as const,
  adapter,
});

const connectionFailedDatabase = (error: unknown) => ({
  state: "connection_failed" as const,
  error,
});

const driverMissingDatabase = (
  configuration: "found" | "missing",
  error = createDriverNotFoundError()
) => ({
  state: "driver_missing" as const,
  configuration,
  error,
});

describe("doctor", () => {
  test("warns when the Tusk version is unknown", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "unknown",
        database: notConfiguredDatabase(),
      });

      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "tusk.version",
          status: "warn",
          message: "Tusk version could not be resolved",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails when database configuration is missing", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: notConfiguredDatabase(new Error("DATABASE_URL was not set")),
      });

      expect(report.result).toBe("fail");
      expect(report.database).toMatchObject({
        state: "not_configured",
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.config",
          status: "fail",
        })
      );
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "migrations.valid",
          status: "pass",
          message: expect.stringContaining("Migration files are valid"),
        })
      );
      expect(report.checks.some((check) => check.id === "database.connection"))
        .toBe(false);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("does not run migration validation when the migrations path is missing", async () => {
    const migrationsPath = join(tmpdir(), `tusk-missing-${Date.now()}`);

    const report = await runDoctor({
      migrationsPath,
      tuskVersion: "0.4.0",
      database: notConfiguredDatabase(),
    });

    expect(report.result).toBe("fail");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "migrations.path",
        status: "fail",
        message: expect.stringContaining("Run `tusk init`"),
      })
    );
    expect(checkIds(report)).not.toContain("migrations.valid");
    expect(report.summary.skipped).toBe(0);
  });

  test("skips file-dependent database checks when the migrations path is missing", async () => {
    const migrationsPath = join(tmpdir(), `tusk-missing-db-${Date.now()}`);
    const { adapter, lockCalls } = createHealthyAdapter();

    const report = await runDoctor({
      migrationsPath,
      tuskVersion: "0.4.0",
      database: configuredDatabase(adapter),
    });

    expect(report.result).toBe("fail");
    expect(report.summary.errors).toBe(1);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "migrations.path",
        status: "fail",
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "database.connection",
        status: "pass",
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "database.migrationTable",
        status: "pass",
      })
    );
    expect(report.database.migrationStatus).toEqual({
      state: "skipped",
      reason: "missing_migrations_path",
    });
    expect(lockCalls).toEqual(["acquire", "release"]);
    expect(checkIds(report)).not.toContain("migrations.valid");
    expect(checkIds(report)).not.toContain("database.drift");
    expect(checkIds(report)).not.toContain("database.status");
  });

  test("warns clearly when the migrations directory is empty", async () => {
    const migrationsPath = await createTempDir();

    try {
      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: notConfiguredDatabase(new Error("DATABASE_URL was not set")),
      });

      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "migrations.valid",
          status: "warn",
          message: "No migration files found yet. Add an .up.sql and .down.sql migration pair before running `tusk up`.",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails with setup guidance when no supported Postgres client is installed", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: driverMissingDatabase("missing"),
      });

      expect(report.result).toBe("fail");
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.driver",
          status: "fail",
          message: expect.stringContaining("No supported Postgres client found"),
        })
      );
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.driver",
          message: expect.stringContaining("bun add pg"),
        })
      );
      expect(checkIds(report)).not.toContain("database.config");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("preserves database configuration state when the driver is missing", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: driverMissingDatabase("found"),
      });

      expect(report.environment.databaseConfiguration).toBe("found");
      expect(report.database).toMatchObject({
        state: "driver_missing",
        configuration: "found",
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.driver",
          status: "fail",
        })
      );
      expect(checkIds(report)).not.toContain("database.config");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails when configured database connection setup failed", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: connectionFailedDatabase(new Error("connection refused")),
      });

      expect(report.result).toBe("fail");
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.config",
          status: "pass",
        })
      );
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.connection",
          status: "fail",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails the database engine check for Amazon Redshift", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter(
            "PostgreSQL 8.0.2 on i686-pc-linux-gnu, compiled by GCC, Redshift 1.0.12345"
          )
        ),
      });

      const engineCheck = report.checks.find((check) => check.id === "database.engine");

      expect(report.result).toBe("fail");
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "unsupported",
          provider: "redshift",
          reason: "unsupported_provider",
        },
      });
      expect(engineCheck).toMatchObject({
        status: "fail",
        message: expect.stringContaining("Amazon Redshift"),
      });
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("detects Redshift before reading PostgreSQL server settings", async () => {
    const migrationsPath = await createTempDir();
    const queries: string[] = [];
    const adapter: DoctorTestAdapter = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string) => {
        queries.push(sql);

        if (sql.includes("current_setting")) {
          throw new Error("Redshift rejected current_setting");
        }

        if (sql.includes("version()")) {
          return queryResult([
            {
              version: "PostgreSQL 8.0.2, Redshift 1.0.12345",
            },
          ] as T[]);
        }

        return queryResult([] as T[]);
      },
      acquireMigrationLock: async () => {},
      releaseMigrationLock: async () => {},
    };

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(toDatabaseAdapter(adapter)),
      });

      expect(report.result).toBe("fail");
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "unsupported",
          provider: "redshift",
        },
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.engine",
          status: "fail",
        })
      );
      expect(queries.some((query) => query.includes("current_setting"))).toBe(false);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails unknown PostgreSQL-compatible database engines", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("CockroachDB CCL v25.1.0", {
            serverVersion: "25.1.0",
            serverVersionNum: "250100",
          })
        ),
      });

      expect(report.result).toBe("fail");
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "unsupported",
          provider: "unknown",
          reason: "unsupported_provider",
        },
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.engine",
          status: "fail",
        })
      );
      expect(checkIds(report)).not.toContain("database.version");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails PostgreSQL versions below the supported floor", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("PostgreSQL 12.22 on x86_64-pc-linux-gnu", {
            serverVersion: "12.22",
            serverVersionNum: "120022",
          })
        ),
      });

      expect(report.result).toBe("fail");
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "unsupported",
          provider: "postgresql",
          reason: "version_below_floor",
        },
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.version",
          status: "fail",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("preserves Aurora provider when the PostgreSQL version is unsupported", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("PostgreSQL 12.22 on x86_64-pc-linux-gnu", {
            serverVersion: "12.22",
            serverVersionNum: "120022",
            auroraVersion: "12.16.4",
          })
        ),
      });

      expect(report.result).toBe("fail");
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "unsupported",
          provider: "aurora-postgresql",
          reason: "version_below_floor",
        },
      });
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails when PostgreSQL version cannot be determined", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("PostgreSQL version unavailable", {
            serverVersion: null,
            serverVersionNum: null,
          })
        ),
      });

      expect(report.result).toBe("fail");
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "unsupported",
          provider: "postgresql",
          reason: "version_unknown",
        },
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.version",
          status: "fail",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("accepts PostgreSQL versions at the supported floor", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("PostgreSQL 13.18 on x86_64-pc-linux-gnu", {
            serverVersion: "13.18",
            serverVersionNum: "130018",
          })
        ),
      });

      expect(report.result).toBe("pass");
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "supported",
          provider: "postgresql",
        },
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.version",
          status: "pass",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("warns when the migration table has not been created yet", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("PostgreSQL 16.9 on x86_64-pc-linux-gnu", {
            serverVersion: "16.9",
            serverVersionNum: "160009",
          })
        ),
      });

      expect(report.result).toBe("pass");
      expect(report.summary.warnings).toBe(1);
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.migrationTable",
          status: "warn",
          message: "_migrations table was not found. Run `tusk up` to initialise migration tracking when applying migrations.",
        })
      );
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.checksumMetadata",
          status: "pass",
        })
      );
      expect(report.database.migrationStatus).toEqual({
        state: "readable",
        executed: 0,
        pending: 1,
      });
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails and skips dependent checks when the migration table shape is invalid", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("PostgreSQL 16.9 on x86_64-pc-linux-gnu", {
            serverVersion: "16.9",
            serverVersionNum: "160009",
            migrationTableExists: true,
            migrationTableColumns: createMigrationTableColumns(true).filter(
              (column) => column.column_name !== "filename"
            ),
          })
        ),
      });

      expect(report.result).toBe("fail");
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.migrationTable",
          status: "fail",
          message: "_migrations table has an invalid shape",
        })
      );
      expect(report.database.migrationTable).toMatchObject({
        state: "invalid_shape",
      });
      expect(checkIds(report)).not.toContain("database.drift");
      expect(checkIds(report)).not.toContain("database.status");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("skips migration status when database drift fails", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("PostgreSQL 16.9 on x86_64-pc-linux-gnu", {
            serverVersion: "16.9",
            serverVersionNum: "160009",
            migrationTableExists: true,
            migrationRows: [
              {
                filename: "1728123456790_missing.up.sql",
                checksum: "stored-checksum",
                executed_at: new Date("2026-01-01T00:00:00.000Z"),
              },
            ],
          })
        ),
      });

      expect(report.result).toBe("fail");
      expect(report.database.migrationStatus).toEqual({
        state: "skipped",
        reason: "unsafe_migration_state",
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.drift",
          status: "fail",
        })
      );
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.status",
          status: "skip",
          message: "Migration status skipped because database validation found unsafe migration state",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("detects Aurora PostgreSQL as a supported PostgreSQL provider", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(
          createVersionAdapter("PostgreSQL 16.9 on x86_64-pc-linux-gnu", {
            serverVersion: "16.9",
            serverVersionNum: "160009",
            auroraVersion: "16.6.3",
          })
        ),
      });

      expect(report.result).toBe("pass");
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "supported",
          provider: "aurora-postgresql",
        },
      });
      expect(report.database.engine).toMatchObject({
        serverVersion: expect.stringContaining("Aurora 16.6.3"),
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.version",
          status: "pass",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("reports a healthy PostgreSQL database", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);
      const { adapter, lockCalls } = createHealthyAdapter();

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(adapter),
      });

      expect(report.result).toBe("pass");
      expect(report.summary.errors).toBe(0);
      expect(report.database).toMatchObject({
        state: "connected",
        engine: {
          state: "supported",
          provider: "postgresql",
        },
        migrationTable: {
          state: "ready",
          checksumState: "enabled",
        },
        migrationStatus: {
          state: "readable",
          executed: 1,
          pending: 0,
        },
      });
      expect(lockCalls).toEqual(["acquire", "release"]);
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.version",
          status: "pass",
        })
      );
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.drift",
          status: "pass",
          message: "No checksum drift detected",
        })
      );
      expect(report.checks.map((check) => check.status)).not.toContain("fail");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("reports advisory lock release failures without duplicating connection checks", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);
      const { adapter } = createHealthyAdapter();
      const failingReleaseAdapter = {
        ...adapter,
        releaseMigrationLock: async () => {
          throw new Error("release failed");
        },
      } as DatabaseAdapter;

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: configuredDatabase(failingReleaseAdapter),
      });

      const connectionChecks = report.checks.filter(
        (check) => check.id === "database.connection"
      );

      expect(report.result).toBe("pass");
      expect(connectionChecks).toHaveLength(1);
      expect(connectionChecks[0]).toMatchObject({ status: "pass" });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.advisoryLock",
          status: "warn",
          message: expect.stringContaining("could not be released"),
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });
});
