import { describe, expect, test } from "bun:test";
import { Pool } from "pg";
import type { DatabaseAdapter } from "../types/migrations";
import type { createPostgresJsAdapter } from "../adapters/postgresjs";
import { createMigrationExecutionError } from "../utils/errors";
import {
  createMigrateHandle,
  createPoolHandle,
  runElysiaStartupMigrations,
  type ElysiaMigrateDeps,
} from "./elysia";

const adapter = { id: "adapter" } as unknown as DatabaseAdapter;

const createFakePostgresSql = () => {
  const sql = (() => undefined) as unknown as Parameters<
    typeof createPostgresJsAdapter
  >[0];

  sql.unsafe = async () => Object.assign([], { count: 0, command: "SELECT" });
  sql.reserve = async () => ({
    unsafe: sql.unsafe,
    release: () => {},
  });
  sql.end = async () => {};

  return sql;
};

const silentDeps = (
  overrides: Partial<ElysiaMigrateDeps> = {}
): ElysiaMigrateDeps => ({
  runUp: async () => ({
    executed: 0,
    pending: 0,
  }),
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  ...overrides,
});

describe("createPoolHandle", () => {
  test("does not take ownership of a caller-provided pool", () => {
    const pool = {} as Pool;

    const handle = createPoolHandle({ pool });

    expect(handle.pool).toBe(pool);
    expect(handle.ownsPool).toBe(false);
  });

  test("creates and owns a pool from a connection string", () => {
    const handle = createPoolHandle({
      connectionString: "postgresql://user:password@localhost:5432/app",
    });

    expect(handle.pool).toBeInstanceOf(Pool);
    expect(handle.ownsPool).toBe(true);

    void handle.pool.end();
  });

  test("creates and owns a pool from DATABASE_URL", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/app";

    try {
      const handle = createPoolHandle({});

      expect(handle.pool).toBeInstanceOf(Pool);
      expect(handle.ownsPool).toBe(true);
      void handle.pool.end();
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    }
  });

  test("rejects an unconfigured env fallback", () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      expect(() => createPoolHandle({})).toThrow(/Missing database configuration/);
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});

describe("createMigrateHandle", () => {
  test("uses a caller-provided postgres.js client without owning it", async () => {
    const sql = createFakePostgresSql();
    const handle = createMigrateHandle({ sql });

    expect(handle.sql).toBe(sql);
    expect(handle.pool).toBeUndefined();
    expect(handle.adapter).toBeDefined();
    await handle.stop();
  });

  test("rejects pool and sql together", () => {
    expect(() =>
      createMigrateHandle({
        pool: {} as Pool,
        sql: createFakePostgresSql(),
      })
    ).toThrow(/either pool or sql/);
  });
});

describe("runElysiaStartupMigrations", () => {
  test("skips migrations when runOnStartup is false", async () => {
    let ran = false;
    await runElysiaStartupMigrations(
      {
        runOnStartup: false,
        implicitStartup: false,
        adapter,
        migrationsPath: "./migrations",
      },
      silentDeps({
        runUp: async () => {
          ran = true;
          return { executed: 0, pending: 0 };
        },
      })
    );

    expect(ran).toBe(false);
  });

  test("warns when startup migrations use the implicit default", async () => {
    const warnings: string[] = [];
    await runElysiaStartupMigrations(
      {
        runOnStartup: true,
        implicitStartup: true,
        adapter,
        migrationsPath: "./migrations",
      },
      silentDeps({
        logger: {
          info: () => {},
          warn: (message) => {
            warnings.push(message);
          },
          error: () => {},
        },
      })
    );

    expect(warnings[0]).toContain("runOnStartup defaults to true");
    expect(warnings[0]).toContain("deploy-step");
  });

  test("does not warn when runOnStartup is explicit", async () => {
    const warnings: string[] = [];
    await runElysiaStartupMigrations(
      {
        runOnStartup: true,
        implicitStartup: false,
        adapter,
        migrationsPath: "./migrations",
      },
      silentDeps({
        logger: {
          info: () => {},
          warn: (message) => {
            warnings.push(message);
          },
          error: () => {},
        },
      })
    );

    expect(warnings).toEqual([]);
  });

  test("logs formatted TuskError details and rethrows", async () => {
    const errors: Array<{ message: string; context?: { error?: string; code?: string } }> =
      [];
    const failure = createMigrationExecutionError("001_fail.up.sql");

    await expect(
      runElysiaStartupMigrations(
        {
          runOnStartup: true,
          implicitStartup: false,
          adapter,
          migrationsPath: "./migrations",
        },
        silentDeps({
          runUp: async () => {
            throw failure;
          },
          logger: {
            info: () => {},
            warn: () => {},
            error: (message, context) => {
              errors.push({
                message,
                context: context as { error?: string; code?: string },
              });
            },
          },
        })
      )
    ).rejects.toBe(failure);

    expect(errors[0]?.message).toBe("Elysia plugin startup migration failed");
    expect(errors[0]?.context?.code).toBe("MIGRATION_EXECUTION_FAILED");
    expect(errors[0]?.context?.error).toContain("[MIGRATION_EXECUTION_FAILED]");
  });

  test("logs unexpected errors and rethrows", async () => {
    const errors: string[] = [];
    const failure = new Error("disk full");

    await expect(
      runElysiaStartupMigrations(
        {
          runOnStartup: true,
          implicitStartup: false,
          adapter,
          migrationsPath: "./migrations",
        },
        silentDeps({
          runUp: async () => {
            throw failure;
          },
          logger: {
            info: () => {},
            warn: () => {},
            error: (_message, context) => {
              errors.push(String(context?.error));
            },
          },
        })
      )
    ).rejects.toBe(failure);

    expect(errors).toEqual(["disk full"]);
  });

  test("rejects an invalid TUSK_STATEMENT_TIMEOUT_MS", () => {
    const previous = process.env.TUSK_STATEMENT_TIMEOUT_MS;
    process.env.TUSK_STATEMENT_TIMEOUT_MS = "nope";

    try {
      expect(() =>
        createMigrateHandle({
          pool: {} as Pool,
        })
      ).toThrow(/TUSK_STATEMENT_TIMEOUT_MS must be a non-negative integer/);
    } finally {
      if (previous === undefined) {
        delete process.env.TUSK_STATEMENT_TIMEOUT_MS;
      } else {
        process.env.TUSK_STATEMENT_TIMEOUT_MS = previous;
      }
    }
  });
});
