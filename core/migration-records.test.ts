import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter, QueryParam } from "../types/migrations";
import {
  getExecutedMigrationCountReadOnly,
  getExecutedMigrationRecordsReadOnly,
  getLastExecutedMigrationFilenamesReadOnly,
} from "./migration-records";

const executedAt = new Date("2026-01-01T00:00:00.000Z");

const createAdapter = (options: {
  tableExists?: boolean;
  hasChecksum?: boolean;
  filenames?: string[];
}) => {
  const queries: string[] = [];
  const tableExists = options.tableExists ?? true;
  const hasChecksum = options.hasChecksum ?? false;
  const filenames = options.filenames ?? [];

  const adapter = {
    query: async (sql: string, params?: QueryParam[]) => {
      queries.push(sql);

      if (sql.includes("to_regclass")) {
        return {
          rows: [{ migration_table: tableExists ? "_migrations" : null }],
          rowCount: 1,
        };
      }

      if (sql.includes("information_schema.columns")) {
        return {
          rows: [{ has_checksum: hasChecksum }],
          rowCount: 1,
        };
      }

      if (sql.includes("ORDER BY id DESC")) {
        const limit = Number(params?.[0] ?? Number.MAX_SAFE_INTEGER);
        return {
          rows: filenames
            .slice()
            .reverse()
            .slice(0, limit)
            .map((filename) => ({ filename })),
          rowCount: filenames.length,
        };
      }

      if (sql.includes("COUNT(*)")) {
        return {
          rows: [{ count: filenames.length }],
          rowCount: 1,
        };
      }

      if (!hasChecksum && sql.includes("filename, checksum")) {
        throw new Error("checksum column should not be selected");
      }

      return {
        rows: filenames.map((filename) => ({
          filename,
          checksum: hasChecksum ? "stored-checksum" : null,
          executed_at: executedAt,
        })),
        rowCount: filenames.length,
      };
    },
  } satisfies Pick<DatabaseAdapter, "query">;

  return { adapter: adapter as DatabaseAdapter, queries };
};

describe("read-only migration records", () => {
  test("returns empty records when the migration table does not exist", async () => {
    const { adapter, queries } = createAdapter({ tableExists: false });

    await expect(getExecutedMigrationRecordsReadOnly(adapter)).resolves.toEqual([]);
    expect(queries.some((query) => query.includes("information_schema.columns"))).toBe(false);
  });

  test("reads legacy migration tables without selecting a missing checksum column", async () => {
    const { adapter, queries } = createAdapter({
      hasChecksum: false,
      filenames: ["1728123456789_create_widgets.up.sql"],
    });

    const records = await getExecutedMigrationRecordsReadOnly(adapter);

    expect(records).toEqual([
      {
        filename: "1728123456789_create_widgets.up.sql",
        checksum: null,
        executed_at: executedAt,
      },
    ]);
    expect(queries.some((query) => query.includes("NULL::text AS checksum"))).toBe(true);
  });

  test("reads rollback filenames without requiring checksum metadata", async () => {
    const { adapter, queries } = createAdapter({
      hasChecksum: false,
      filenames: [
        "1728123456789_create_widgets.up.sql",
        "1728123456790_create_users.up.sql",
      ],
    });

    const filenames = await getLastExecutedMigrationFilenamesReadOnly(adapter, 1);

    expect(filenames).toEqual(["1728123456790_create_users.up.sql"]);
    expect(queries.some((query) => query.includes("checksum"))).toBe(false);
  });

  test("counts executed migrations without selecting migration file rows", async () => {
    const { adapter, queries } = createAdapter({
      filenames: [
        "1728123456789_create_widgets.up.sql",
        "1728123456790_create_users.up.sql",
      ],
    });

    await expect(getExecutedMigrationCountReadOnly(adapter)).resolves.toBe(2);
    expect(queries.some((query) => query.includes("COUNT(*)::integer"))).toBe(true);
    expect(queries.some((query) => query.includes("ORDER BY id ASC"))).toBe(false);
  });

  test("returns zero count when the migration table does not exist", async () => {
    const { adapter, queries } = createAdapter({ tableExists: false });

    await expect(getExecutedMigrationCountReadOnly(adapter)).resolves.toBe(0);
    expect(queries.some((query) => query.includes("COUNT(*)"))).toBe(false);
  });
});
