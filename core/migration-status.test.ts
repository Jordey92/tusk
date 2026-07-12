import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DatabaseAdapter, QueryParam } from "../types/migrations";
import { getMigrationStatus } from "./migration-status";

describe("migration status", () => {
  test("treats missing metadata as empty state without creating or altering tables", async () => {
    const migrationsPath = await mkdtemp(join(tmpdir(), "tusk-status-readonly-"));
    const statements: string[] = [];
    const adapter = {
      query: async (sql: string, _params?: QueryParam[]) => {
        statements.push(sql);
        if (sql.includes("to_regclass")) {
          return { rows: [{ migration_table: null }], rowCount: 1 };
        }
        throw new Error(`Unexpected status query: ${sql}`);
      },
    } as DatabaseAdapter;

    try {
      await writeFile(
        join(migrationsPath, "1728123456789_widgets.up.sql"),
        "CREATE TABLE widgets (id INTEGER);"
      );
      const status = await getMigrationStatus(adapter, migrationsPath);

      expect(status.summary).toEqual({ executed: 0, pending: 1 });
      expect(
        statements.some((sql) => /\b(?:CREATE|ALTER)\s+TABLE\b/i.test(sql))
      ).toBe(false);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });
});
