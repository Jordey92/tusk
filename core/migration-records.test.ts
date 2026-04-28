import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter, QueryParam } from "../types/migrations";
import {
  assertMigrationTableShape,
  getExecutedMigrationCountReadOnly,
  getExecutedMigrationRecordsReadOnly,
  getLastExecutedMigrationFilenamesReadOnly,
  getMigrationTableStateReadOnly,
} from "./migration-records";

const executedAt = new Date("2026-01-01T00:00:00.000Z");

const createValidColumns = (hasChecksum: boolean) => [
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

const validConstraints: Array<{
  constraint_type: "p" | "u";
  columns: string[];
}> = [
  { constraint_type: "p", columns: ["id"] },
  { constraint_type: "u", columns: ["filename"] },
];

const createAdapter = (options: {
  tableExists?: boolean;
  hasChecksum?: boolean;
  filenames?: string[];
  columns?: Array<{
    column_name: string;
    formatted_type: string;
    is_not_null: boolean;
    column_default: string | null;
    identity_generation: string | null;
  }>;
  constraints?: Array<{
    constraint_type: "p" | "u";
    columns: string[];
  }>;
}) => {
  const queries: string[] = [];
  const tableExists = options.tableExists ?? true;
  const hasChecksum = options.hasChecksum ?? true;
  const filenames = options.filenames ?? [];
  const columns = options.columns ?? createValidColumns(hasChecksum);
  const constraints = options.constraints ?? validConstraints;

  const adapter = {
    query: async (sql: string, params?: QueryParam[]) => {
      queries.push(sql);

      if (sql.includes("pg_constraint")) {
        return {
          rows: constraints,
          rowCount: constraints.length,
        };
      }

      if (sql.includes("pg_attribute")) {
        return {
          rows: columns,
          rowCount: columns.length,
        };
      }

      if (sql.includes("to_regclass")) {
        return {
          rows: [{ migration_table: tableExists ? "_migrations" : null }],
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
  test("reports a valid metadata table shape", async () => {
    const { adapter } = createAdapter({ hasChecksum: true });

    await expect(getMigrationTableStateReadOnly(adapter)).resolves.toMatchObject({
      exists: true,
      hasChecksum: true,
      valid: true,
      issues: [],
      legacyChecksumColumnMissing: false,
    });
  });

  test("returns empty records when the migration table does not exist", async () => {
    const { adapter, queries } = createAdapter({ tableExists: false });

    await expect(getExecutedMigrationRecordsReadOnly(adapter)).resolves.toEqual([]);
    expect(queries.some((query) => query.includes("pg_attribute"))).toBe(false);
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

  test("treats a missing checksum column as a legacy-compatible shape", async () => {
    const { adapter } = createAdapter({ hasChecksum: false });

    await expect(getMigrationTableStateReadOnly(adapter)).resolves.toMatchObject({
      exists: true,
      hasChecksum: false,
      valid: true,
      issues: [],
      legacyChecksumColumnMissing: true,
    });
  });

  test("rejects metadata tables missing required columns", async () => {
    const { adapter } = createAdapter({
      columns: createValidColumns(true).filter(
        (column) => column.column_name !== "filename"
      ),
    });

    const state = await getMigrationTableStateReadOnly(adapter);

    expect(state.valid).toBe(false);
    expect(state.issues).toContainEqual(
      expect.objectContaining({
        code: "missing_column",
        column: "filename",
      })
    );
    await expect(assertMigrationTableShape(adapter)).rejects.toThrow(
      "_migrations table has an invalid shape"
    );
  });

  test("rejects metadata tables with wrong column types", async () => {
    const { adapter } = createAdapter({
      columns: createValidColumns(true).map((column) =>
        column.column_name === "id"
          ? { ...column, formatted_type: "bigint" }
          : column
      ),
    });

    const state = await getMigrationTableStateReadOnly(adapter);

    expect(state.valid).toBe(false);
    expect(state.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid_column_type",
        column: "id",
        expected: "integer",
        actual: "bigint",
      })
    );
  });

  test("rejects metadata tables without required constraints", async () => {
    const { adapter } = createAdapter({
      constraints: [{ constraint_type: "p", columns: ["id"] }],
    });

    const state = await getMigrationTableStateReadOnly(adapter);

    expect(state.valid).toBe(false);
    expect(state.issues).toContainEqual(
      expect.objectContaining({
        code: "missing_unique_constraint",
        column: "filename",
      })
    );
  });

  test("rejects metadata tables where id is not generated", async () => {
    const { adapter } = createAdapter({
      columns: createValidColumns(true).map((column) =>
        column.column_name === "id"
          ? { ...column, column_default: null, identity_generation: null }
          : column
      ),
    });

    const state = await getMigrationTableStateReadOnly(adapter);

    expect(state.valid).toBe(false);
    expect(state.issues).toContainEqual(
      expect.objectContaining({
        code: "missing_generated_value",
        column: "id",
      })
    );
  });

  test("rejects metadata tables where executed_at is not defaulted", async () => {
    const { adapter } = createAdapter({
      columns: createValidColumns(true).map((column) =>
        column.column_name === "executed_at"
          ? { ...column, column_default: null }
          : column
      ),
    });

    const state = await getMigrationTableStateReadOnly(adapter);

    expect(state.valid).toBe(false);
    expect(state.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid_column_default",
        column: "executed_at",
        expected: "DEFAULT now()",
        actual: "none",
      })
    );
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
