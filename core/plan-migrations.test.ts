import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DatabaseAdapter, QueryParam } from "../types/migrations";
import { createDownPlan, createUpPlan } from "./plan-migrations";

const createTempDir = async () => mkdtemp(join(tmpdir(), "tusk-plan-"));

const writeMigrationPair = async (
  migrationsPath: string,
  baseName: string,
  upSql: string,
  downSql: string
) => {
  await writeFile(join(migrationsPath, `${baseName}.up.sql`), upSql);
  await writeFile(join(migrationsPath, `${baseName}.down.sql`), downSql);
};

const migrationTableColumns = [
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
  {
    column_name: "checksum",
    formatted_type: "character varying(64)",
    is_not_null: false,
    column_default: null,
    identity_generation: null,
  },
];

const migrationTableConstraints: Array<{
  constraint_type: "p" | "u";
  columns: string[];
}> = [
  { constraint_type: "p", columns: ["id"] },
  { constraint_type: "u", columns: ["filename"] },
];

const createAdapter = (executedFilenames: string[] = []) => {
  const adapter = {
    query: async (sql: string, params?: QueryParam[]) => {
      if (sql.includes("pg_constraint")) {
        return {
          rows: migrationTableConstraints,
          rowCount: migrationTableConstraints.length,
        };
      }

      if (sql.includes("pg_attribute")) {
        return {
          rows: migrationTableColumns,
          rowCount: migrationTableColumns.length,
        };
      }

      if (sql.includes("to_regclass")) {
        return {
          rows: [{ migration_table: executedFilenames.length > 0 ? "_migrations" : null }],
          rowCount: 1,
        };
      }

      if (sql.includes("COUNT(*)")) {
        return {
          rows: [{ count: executedFilenames.length }],
          rowCount: 1,
        };
      }

      if (sql.includes("ORDER BY id DESC")) {
        const limit = Number(params?.[0] ?? Number.MAX_SAFE_INTEGER);
        return {
          rows: executedFilenames
            .slice()
            .reverse()
            .slice(0, limit)
            .map((filename) => ({
              filename,
              checksum: null,
              executed_at: new Date("2026-01-01T00:00:00.000Z"),
            })),
          rowCount: executedFilenames.length,
        };
      }

      return {
        rows: executedFilenames.map((filename) => ({
          filename,
          checksum: null,
          executed_at: new Date("2026-01-01T00:00:00.000Z"),
        })),
        rowCount: executedFilenames.length,
      };
    },
  } satisfies Pick<DatabaseAdapter, "query">;

  return adapter as DatabaseAdapter;
};

describe("migration plans", () => {
  test("creates an up plan for pending migrations without creating migration state", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE IF EXISTS widgets;"
      );

      const plan = await createUpPlan(createAdapter(), migrationsPath);

      expect(plan.direction).toBe("up");
      expect(plan.summary).toEqual({
        planned: 1,
        total: 1,
        alreadyExecuted: 0,
      });
      expect(plan.migrations[0]?.filename).toBe("1728123456789_create_widgets.up.sql");
      expect(typeof plan.migrations[0]?.checksum).toBe("string");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("creates a down plan from executed migration order", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE IF EXISTS widgets;"
      );

      const plan = await createDownPlan(
        createAdapter(["1728123456789_create_widgets.up.sql"]),
        migrationsPath,
        1
      );

      expect(plan.direction).toBe("down");
      expect(plan.summary).toMatchObject({
        planned: 1,
        total: 1,
        rollbackTarget: {
          mode: "count",
          requestedCount: 1,
          availableRollbackCount: 1,
        },
      });
      expect(plan.migrations[0]?.filename).toBe("1728123456789_create_widgets.down.sql");
      expect(plan.migrations[0]?.rollbackOf).toBe("1728123456789_create_widgets.up.sql");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("defaults down plans to the latest applied migration only", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE IF EXISTS widgets;"
      );
      await writeMigrationPair(
        migrationsPath,
        "1728123456790_create_gadgets",
        "CREATE TABLE gadgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE IF EXISTS gadgets;"
      );

      const plan = await createDownPlan(
        createAdapter([
          "1728123456789_create_widgets.up.sql",
          "1728123456790_create_gadgets.up.sql",
        ]),
        migrationsPath
      );

      expect(plan.summary).toMatchObject({
        planned: 1,
        rollbackTarget: {
          mode: "count",
          requestedCount: 1,
          availableRollbackCount: 2,
        },
      });
      expect(plan.migrations.map((migration) => migration.rollbackOf)).toEqual([
        "1728123456790_create_gadgets.up.sql",
      ]);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("plans all applied migrations only when explicitly requested", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE IF EXISTS widgets;"
      );
      await writeMigrationPair(
        migrationsPath,
        "1728123456790_create_gadgets",
        "CREATE TABLE gadgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE IF EXISTS gadgets;"
      );

      const plan = await createDownPlan(
        createAdapter([
          "1728123456789_create_widgets.up.sql",
          "1728123456790_create_gadgets.up.sql",
        ]),
        migrationsPath,
        { all: true }
      );

      expect(plan.summary).toMatchObject({
        planned: 2,
        rollbackTarget: {
          mode: "all",
          availableRollbackCount: 2,
        },
      });
      expect(plan.migrations.map((migration) => migration.rollbackOf)).toEqual([
        "1728123456790_create_gadgets.up.sql",
        "1728123456789_create_widgets.up.sql",
      ]);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("refuses adopted-baseline rollback unless explicitly allowed", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "0000000000000_initial",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE widgets CASCADE;"
      );
      const adapter = createAdapter(["0000000000000_initial.up.sql"]);

      await expect(createDownPlan(adapter, migrationsPath)).rejects.toThrow(
        /Refusing to roll back the adopted baseline.*--allow-baseline-rollback.*allowBaselineRollback/
      );

      const plan = await createDownPlan(adapter, migrationsPath, {
        allowBaselineRollback: true,
      });
      expect(plan.migrations.map((migration) => migration.rollbackOf)).toEqual([
        "0000000000000_initial.up.sql",
      ]);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("refuses unsafe transaction control before returning an up plan", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_unsafe",
        "CREATE TABLE unsafe (id INTEGER); COMMIT;",
        "DROP TABLE unsafe;"
      );

      await expect(createUpPlan(createAdapter(), migrationsPath)).rejects.toThrow(
        "Migration validation failed"
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });
});
