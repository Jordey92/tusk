import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DatabaseAdapter, QueryParam } from "../types/migrations";
import { calculateChecksum } from "../utils/checksum";
import {
  resolveDownMigrationState,
  resolveUpMigrationState,
} from "./migration-resolution";

const createTempDir = async () => mkdtemp(join(tmpdir(), "tusk-resolution-"));

const writeMigrationPair = async (
  migrationsPath: string,
  baseName: string,
  upSql: string,
  downSql: string
) => {
  await writeFile(join(migrationsPath, `${baseName}.up.sql`), upSql);
  await writeFile(join(migrationsPath, `${baseName}.down.sql`), downSql);
};

const createValidColumns = () => [
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

const validConstraints: Array<{
  constraint_type: "p" | "u";
  columns: string[];
}> = [
  { constraint_type: "p", columns: ["id"] },
  { constraint_type: "u", columns: ["filename"] },
];

interface AdapterOptions {
  records?: Array<{ filename: string; checksum: string | null }>;
  migrationTable?: "present" | "missing";
}

const createAdapter = ({
  records = [],
  migrationTable = "present",
}: AdapterOptions = {}) => {
  const adapter = {
    query: async (sql: string, params?: QueryParam[]) => {
      if (sql.includes("pg_constraint")) {
        return {
          rows: validConstraints,
          rowCount: validConstraints.length,
        };
      }

      if (sql.includes("pg_attribute")) {
        const columns = createValidColumns();
        return {
          rows: columns,
          rowCount: columns.length,
        };
      }

      if (sql.includes("to_regclass")) {
        return {
          rows: [
            {
              migration_table: migrationTable === "present" ? "_migrations" : null,
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes("COUNT(*)")) {
        return {
          rows: [{ count: records.length }],
          rowCount: 1,
        };
      }

      if (sql.includes("ORDER BY id DESC")) {
        const limit = Number(params?.[0] ?? Number.MAX_SAFE_INTEGER);
        return {
          rows: records
            .slice()
            .reverse()
            .slice(0, limit)
            .map((record) => ({ filename: record.filename })),
          rowCount: records.length,
        };
      }

      return {
        rows: records.map((record) => ({
          ...record,
          executed_at: new Date("2026-01-01T00:00:00.000Z"),
        })),
        rowCount: records.length,
      };
    },
  } satisfies Pick<DatabaseAdapter, "query">;

  return adapter as DatabaseAdapter;
};

describe("migration resolution", () => {
  test("resolves local executed and pending up migrations", async () => {
    const migrationsPath = await createTempDir();
    const upSql = "CREATE TABLE widgets (id INTEGER PRIMARY KEY);";

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        upSql,
        "DROP TABLE widgets;"
      );
      await writeMigrationPair(
        migrationsPath,
        "1728123456790_create_gadgets",
        "CREATE TABLE gadgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE gadgets;"
      );

      const state = await resolveUpMigrationState(
        createAdapter({
          records: [
            {
              filename: "1728123456789_create_widgets.up.sql",
              checksum: calculateChecksum(upSql),
            },
          ],
        }),
        migrationsPath
      );

      expect(state.executedLocalMigrations.map((migration) => migration.filename)).toEqual([
        "1728123456789_create_widgets.up.sql",
      ]);
      expect(state.pendingMigrations.map((migration) => migration.filename)).toEqual([
        "1728123456790_create_gadgets.up.sql",
      ]);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("fails up resolution when executed migration checksums drift", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE widgets;"
      );

      await expect(
        resolveUpMigrationState(
          createAdapter({
            records: [
              {
                filename: "1728123456789_create_widgets.up.sql",
                checksum: "different",
              },
            ],
          }),
          migrationsPath
        )
      ).rejects.toThrow("has been modified after execution");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("resolves down migrations from latest executed filenames", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE widgets;"
      );
      await writeMigrationPair(
        migrationsPath,
        "1728123456790_create_gadgets",
        "CREATE TABLE gadgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE gadgets;"
      );

      const state = await resolveDownMigrationState(
        createAdapter({
          records: [
            { filename: "1728123456789_create_widgets.up.sql", checksum: null },
            { filename: "1728123456790_create_gadgets.up.sql", checksum: null },
          ],
        }),
        migrationsPath,
        1
      );

      expect(state.requestedCount).toBe(1);
      expect(state.availableRollbackCount).toBe(2);
      expect(state.rollbackMigrations.map((migration) => migration.filename)).toEqual([
        "1728123456790_create_gadgets.down.sql",
      ]);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("models an existing empty metadata table independently from record count", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE widgets;"
      );

      const state = await resolveUpMigrationState(createAdapter(), migrationsPath);

      expect(state.executedLocalMigrations).toEqual([]);
      expect(state.pendingMigrations.map((migration) => migration.filename)).toEqual([
        "1728123456789_create_widgets.up.sql",
      ]);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });
});
