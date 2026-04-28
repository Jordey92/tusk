import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { DatabaseAdapter } from "../types/migrations";
import { validateMigrations } from "./validate-migrations";

const createTempDir = async () => mkdtemp(join(tmpdir(), "tusk-validate-"));

const writeMigrationPair = async (
  migrationsPath: string,
  baseName: string,
  upSql: string,
  downSql: string
) => {
  await writeFile(join(migrationsPath, `${baseName}.up.sql`), upSql);
  await writeFile(join(migrationsPath, `${baseName}.down.sql`), downSql);
};

const validMigrationTableColumns = [
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

const validMigrationTableConstraints: Array<{
  constraint_type: "p" | "u";
  columns: string[];
}> = [
  { constraint_type: "p", columns: ["id"] },
  { constraint_type: "u", columns: ["filename"] },
];

describe("validateMigrations", () => {
  test("passes for paired migration files with executable SQL", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE IF EXISTS widgets;"
      );

      const result = await validateMigrations(migrationsPath);

      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.summary).toEqual({
        errors: 0,
        warnings: 0,
        files: 2,
        up: 1,
        down: 1,
      });
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("reports invalid filenames, missing pairs, empty SQL, and transaction statements", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeFile(join(migrationsPath, "not_a_migration.sql"), "SELECT 1;");
      await writeFile(join(migrationsPath, "1728123456789_create_widgets.up.sql"), "-- TODO");
      await writeFile(
        join(migrationsPath, "1728123456790_create_users.up.sql"),
        "BEGIN; CREATE TABLE users (id INTEGER PRIMARY KEY); COMMIT;"
      );
      await writeFile(
        join(migrationsPath, "1728123456790_create_users.down.sql"),
        "DROP TABLE IF EXISTS users;"
      );

      const result = await validateMigrations(migrationsPath);
      const codes = result.issues.map((issue) => issue.code);

      expect(result.ok).toBe(false);
      expect(codes).toContain("INVALID_MIGRATION_FILENAME");
      expect(codes).toContain("MISSING_DOWN_MIGRATION");
      expect(codes).toContain("EMPTY_MIGRATION_SQL");
      expect(codes).toContain("TRANSACTION_STATEMENT_NOT_ALLOWED");
      expect(result.summary.up).toBe(2);
      expect(result.summary.down).toBe(1);
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("reports transaction statements without trailing semicolons", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456791_create_users",
        "CREATE TABLE users (id INTEGER PRIMARY KEY);\nCOMMIT",
        "DROP TABLE IF EXISTS users;"
      );

      const result = await validateMigrations(migrationsPath);

      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(
        "TRANSACTION_STATEMENT_NOT_ALLOWED"
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("allows transaction keywords inside SQL string literals", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_logs",
        `
        CREATE TABLE logs (message TEXT NOT NULL);
        INSERT INTO logs (message) VALUES ('BEGIN;'), ('COMMIT;'), ($$ROLLBACK;$$);
        `,
        "DROP TABLE IF EXISTS logs;"
      );

      const result = await validateMigrations(migrationsPath);

      expect(result.ok).toBe(true);
      expect(result.issues.map((issue) => issue.code)).not.toContain(
        "TRANSACTION_STATEMENT_NOT_ALLOWED"
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("allows transaction keywords inside comments and quoted identifiers", async () => {
    const migrationsPath = await createTempDir();

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456790_create_quoted_logs",
        `
        -- ; BEGIN;
        /* ; COMMIT; */
        CREATE TABLE quoted_logs ("; START TRANSACTION;" TEXT NOT NULL);
        INSERT INTO quoted_logs ("; START TRANSACTION;")
          VALUES ('x BEGIN;', 'ignore '' ; COMMIT; '' still string', $$ ; ROLLBACK; $$);
        /* ; ROLLBACK;
        `,
        "DROP TABLE IF EXISTS quoted_logs;"
      );

      const result = await validateMigrations(migrationsPath);

      expect(result.ok).toBe(true);
      expect(result.issues.map((issue) => issue.code)).not.toContain(
        "TRANSACTION_STATEMENT_NOT_ALLOWED"
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("reports checksum drift when database checks are enabled", async () => {
    const migrationsPath = await createTempDir();
    const filename = "1728123456789_create_widgets.up.sql";

    try {
      await writeMigrationPair(
        migrationsPath,
        "1728123456789_create_widgets",
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
        "DROP TABLE IF EXISTS widgets;"
      );

      const adapter = {
        query: async (sql: string) => {
          if (sql.includes("pg_constraint")) {
            return { rows: validMigrationTableConstraints, rowCount: 2 };
          }

          if (sql.includes("pg_attribute")) {
            return { rows: validMigrationTableColumns, rowCount: 4 };
          }

          if (sql.includes("to_regclass")) {
            return { rows: [{ migration_table: "_migrations" }], rowCount: 1 };
          }

          return {
            rows: [
              {
                filename,
                checksum: "not-the-current-checksum",
                executed_at: new Date("2026-01-01T00:00:00.000Z"),
              },
            ],
            rowCount: 1,
          };
        },
      } satisfies Pick<DatabaseAdapter, "query">;

      const result = await validateMigrations(migrationsPath, {
        adapter: adapter as DatabaseAdapter,
        checkDatabase: true,
      });

      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(
        "EXECUTED_MIGRATION_CHECKSUM_MISMATCH"
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });

  test("reports an applied migration that is missing on disk", async () => {
    const migrationsPath = await createTempDir();

    try {
      const adapter = {
        query: async (sql: string) => {
          if (sql.includes("pg_constraint")) {
            return { rows: validMigrationTableConstraints, rowCount: 2 };
          }

          if (sql.includes("pg_attribute")) {
            return { rows: validMigrationTableColumns, rowCount: 4 };
          }

          if (sql.includes("to_regclass")) {
            return { rows: [{ migration_table: "_migrations" }], rowCount: 1 };
          }

          return {
            rows: [
              {
                filename: "1728123456789_missing.up.sql",
                checksum: "stored-checksum",
                executed_at: new Date("2026-01-01T00:00:00.000Z"),
              },
            ],
            rowCount: 1,
          };
        },
      } satisfies Pick<DatabaseAdapter, "query">;

      const result = await validateMigrations(migrationsPath, {
        adapter: adapter as DatabaseAdapter,
        checkDatabase: true,
      });

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "EXECUTED_MIGRATION_FILE_MISSING",
          filename: "1728123456789_missing.up.sql",
        })
      );
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
  });
});
