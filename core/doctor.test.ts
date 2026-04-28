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
  { column_name: "id", formatted_type: "integer", is_not_null: true },
  {
    column_name: "filename",
    formatted_type: "character varying(255)",
    is_not_null: true,
  },
  {
    column_name: "executed_at",
    formatted_type: "timestamp without time zone",
    is_not_null: false,
  },
  ...(hasChecksum
    ? [
        {
          column_name: "checksum",
          formatted_type: "character varying(64)",
          is_not_null: false,
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
      return queryResult([] as T[]);
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

describe("doctor", () => {
  test("warns when the Tusk version is unknown", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "unknown",
        database: {
          configured: false,
        },
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
        database: {
          configured: false,
          error: new Error("DATABASE_URL was not set"),
        },
      });

      expect(report.ok).toBe(false);
      expect(report.database).toMatchObject({
        configured: false,
        connected: false,
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
      database: {
        configured: false,
      },
    });

    expect(report.ok).toBe(false);
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
      database: {
        configured: true,
        adapter,
      },
    });

    expect(report.ok).toBe(false);
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
    expect(report.database.status).toBeUndefined();
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
        database: {
          configured: false,
          error: new Error("DATABASE_URL was not set"),
        },
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
        database: {
          configured: false,
          error: createDriverNotFoundError(),
        },
      });

      expect(report.ok).toBe(false);
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
        database: {
          configured: true,
          error: createDriverNotFoundError(),
        },
      });

      expect(report.environment.databaseConfigured).toBe(true);
      expect(report.database.configured).toBe(true);
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
        database: {
          configured: true,
          error: new Error("connection refused"),
        },
      });

      expect(report.ok).toBe(false);
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
        database: {
          configured: true,
          adapter: createVersionAdapter(
            "PostgreSQL 8.0.2 on i686-pc-linux-gnu, compiled by GCC, Redshift 1.0.12345"
          ),
        },
      });

      const engineCheck = report.checks.find((check) => check.id === "database.engine");

      expect(report.ok).toBe(false);
      expect(report.database.provider).toBe("redshift");
      expect(report.database.supported).toBe(false);
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
        database: {
          configured: true,
          adapter: toDatabaseAdapter(adapter),
        },
      });

      expect(report.ok).toBe(false);
      expect(report.database.provider).toBe("redshift");
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
        database: {
          configured: true,
          adapter: createVersionAdapter("CockroachDB CCL v25.1.0", {
            serverVersion: "25.1.0",
            serverVersionNum: "250100",
          }),
        },
      });

      expect(report.ok).toBe(false);
      expect(report.database).toMatchObject({
        engine: "unknown",
        provider: "unknown",
        supported: false,
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
        database: {
          configured: true,
          adapter: createVersionAdapter("PostgreSQL 12.22 on x86_64-pc-linux-gnu", {
            serverVersion: "12.22",
            serverVersionNum: "120022",
          }),
        },
      });

      expect(report.ok).toBe(false);
      expect(report.database).toMatchObject({
        provider: "postgresql",
        supported: false,
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

  test("fails when PostgreSQL version cannot be determined", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(migrationsPath);

      const report = await runDoctor({
        migrationsPath,
        tuskVersion: "0.4.0",
        database: {
          configured: true,
          adapter: createVersionAdapter("PostgreSQL version unavailable", {
            serverVersion: null,
            serverVersionNum: null,
          }),
        },
      });

      expect(report.ok).toBe(false);
      expect(report.database).toMatchObject({
        provider: "postgresql",
        supported: false,
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
        database: {
          configured: true,
          adapter: createVersionAdapter("PostgreSQL 13.18 on x86_64-pc-linux-gnu", {
            serverVersion: "13.18",
            serverVersionNum: "130018",
          }),
        },
      });

      expect(report.ok).toBe(true);
      expect(report.database).toMatchObject({
        provider: "postgresql",
        supported: true,
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
        database: {
          configured: true,
          adapter: createVersionAdapter("PostgreSQL 16.9 on x86_64-pc-linux-gnu", {
            serverVersion: "16.9",
            serverVersionNum: "160009",
          }),
        },
      });

      expect(report.ok).toBe(true);
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
      expect(report.database.status).toEqual({
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
        database: {
          configured: true,
          adapter: createVersionAdapter("PostgreSQL 16.9 on x86_64-pc-linux-gnu", {
            serverVersion: "16.9",
            serverVersionNum: "160009",
            migrationTableExists: true,
            migrationTableColumns: createMigrationTableColumns(true).filter(
              (column) => column.column_name !== "filename"
            ),
          }),
        },
      });

      expect(report.ok).toBe(false);
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          id: "database.migrationTable",
          status: "fail",
          message: "_migrations table has an invalid shape",
        })
      );
      expect(report.database.migrationTable).toMatchObject({
        exists: true,
        valid: false,
      });
      expect(checkIds(report)).not.toContain("database.drift");
      expect(checkIds(report)).not.toContain("database.status");
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
        database: {
          configured: true,
          adapter: createVersionAdapter("PostgreSQL 16.9 on x86_64-pc-linux-gnu", {
            serverVersion: "16.9",
            serverVersionNum: "160009",
            auroraVersion: "16.6.3",
          }),
        },
      });

      expect(report.ok).toBe(true);
      expect(report.database).toMatchObject({
        provider: "aurora-postgresql",
        supported: true,
      });
      expect(report.database.serverVersion).toContain("Aurora 16.6.3");
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
        database: {
          configured: true,
          adapter,
        },
      });

      expect(report.ok).toBe(true);
      expect(report.summary.errors).toBe(0);
      expect(report.database).toMatchObject({
        provider: "postgresql",
        supported: true,
        migrationTable: {
          exists: true,
          hasChecksum: true,
        },
        status: {
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
        database: {
          configured: true,
          adapter: failingReleaseAdapter,
        },
      });

      const connectionChecks = report.checks.filter(
        (check) => check.id === "database.connection"
      );

      expect(report.ok).toBe(true);
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
