import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DatabaseAdapter } from "../types/migrations";
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

const createAdapter = (executedFilenames: string[] = []) => ({
  query: async (sql: string, params?: unknown[]) => {
    if (sql.includes("to_regclass")) {
      return {
        rows: [{ migration_table: executedFilenames.length > 0 ? "_migrations" : null }],
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
}) as unknown as DatabaseAdapter;

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
      expect(plan.summary).toEqual({
        planned: 1,
        total: 1,
        requestedCount: 1,
      });
      expect(plan.migrations[0]?.filename).toBe("1728123456789_create_widgets.down.sql");
      expect(plan.migrations[0]?.rollbackOf).toBe("1728123456789_create_widgets.up.sql");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });
});
