import { afterEach, describe, expect, test } from "bun:test";
import { createPgAdapter } from "../adapters/pg";
import { cleanupMigrations, createTestPool } from "../utils/test-helper";
import {
  ensureMigrationsTable,
  getExecutedMigrations,
  getExecutedMigrationsWithChecksums,
  getLastExecutedMigrations,
  markAsExecuted,
  markAsRolledBack,
} from "./track-migrations";

describe("track migrations", () => {
  const pool = createTestPool();
  afterEach(async () => {
    await cleanupMigrations(pool);
  });

  describe("ensureMigrationsTable", () => {
    test("should create _migrations table if it doesn't exist", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      const result = await adapter.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = '_migrations'
    )
  `);
      expect(result.rows[0].exists).toBe(true);
    });

    test("should be idempotent (safe to call multiple times)", async () => {
      const adapter = createPgAdapter(pool);

      // Call multiple times
      await ensureMigrationsTable(adapter);
      await ensureMigrationsTable(adapter);
      await ensureMigrationsTable(adapter);

      const result = await adapter.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = '_migrations'
        )
      `);
      expect(result.rows[0].exists).toBe(true);
    });

    test("should create table with correct structure", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      const result = await adapter.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = '_migrations'
        ORDER BY ordinal_position
      `);

      expect(result.rows).toHaveLength(4);
      expect(result.rows[0]).toMatchObject({
        column_name: "id",
        data_type: "integer",
        is_nullable: "NO",
      });
      expect(result.rows[0].column_default).toContain("nextval");
      expect(result.rows[1]).toMatchObject({
        column_name: "filename",
        data_type: "character varying",
        is_nullable: "NO"
      });
      expect(result.rows[2]).toMatchObject({
        column_name: "executed_at",
        is_nullable: "YES"
      });
      expect(result.rows[2].column_default).toBe("now()");
      expect(result.rows[3]).toMatchObject({
        column_name: "checksum",
        data_type: "character varying",
        is_nullable: "YES"
      });
    });

    test("should upgrade a legacy table missing the checksum column", async () => {
      const adapter = createPgAdapter(pool);

      await adapter.query(`
        CREATE TABLE _migrations (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await adapter.query(
        `INSERT INTO _migrations (filename) VALUES ('123_legacy.up.sql')`
      );

      await ensureMigrationsTable(adapter);

      const columns = await adapter.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = '_migrations'
          AND column_name = 'checksum'
      `);
      const records = await getExecutedMigrationsWithChecksums(adapter);

      expect(columns.rows).toEqual([
        expect.objectContaining({
          column_name: "checksum",
          data_type: "character varying",
        }),
      ]);
      expect(records).toEqual([
        expect.objectContaining({
          filename: "123_legacy.up.sql",
          checksum: null,
        }),
      ]);
    });

    test("should reject a metadata table where id is not generated", async () => {
      const adapter = createPgAdapter(pool);

      await adapter.query(`
        CREATE TABLE _migrations (
          id INTEGER PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP DEFAULT NOW(),
          checksum VARCHAR(64)
        )
      `);

      await expect(ensureMigrationsTable(adapter)).rejects.toThrow(
        "_migrations.id must be auto-generated"
      );
    });

    test("should reject an invalid legacy table before adding checksum metadata", async () => {
      const adapter = createPgAdapter(pool);

      await adapter.query(`
        CREATE TABLE _migrations (
          id INTEGER PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await expect(ensureMigrationsTable(adapter)).rejects.toThrow(
        "_migrations.id must be auto-generated"
      );

      const columns = await adapter.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = '_migrations'
          AND column_name = 'checksum'
      `);

      expect(columns.rows).toHaveLength(0);
    });

    test("should reject a metadata table where executed_at is not defaulted", async () => {
      const adapter = createPgAdapter(pool);

      await adapter.query(`
        CREATE TABLE _migrations (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP,
          checksum VARCHAR(64)
        )
      `);

      await expect(ensureMigrationsTable(adapter)).rejects.toThrow(
        "_migrations.executed_at must default to now()"
      );
    });
  });

  describe("getExecutedMigrations", () => {
    test("should return empty Set if no migrations executed", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      const executed = await getExecutedMigrations(adapter);

      expect(executed).toBeInstanceOf(Set);
      expect(executed.size).toBe(0);
    });

    test("should return Set of executed migration filenames", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      // Insert a test migration
      await adapter.query(
        `INSERT INTO _migrations (filename) VALUES ('test.sql')`
      );

      const executed = await getExecutedMigrations(adapter);

      expect(executed.size).toBe(1);
      expect(executed.has("test.sql")).toBe(true);
    });

    test("should return all migrations when multiple exist", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      // Insert multiple migrations
      const filenames = [
        "001_create_users.up.sql",
        "002_create_posts.up.sql",
        "003_add_indexes.up.sql"
      ];

      for (const filename of filenames) {
        await adapter.query(
          `INSERT INTO _migrations (filename) VALUES ($1)`, [filename]
        );
      }

      const executed = await getExecutedMigrations(adapter);

      expect(executed.size).toBe(3);
      filenames.forEach(filename => {
        expect(executed.has(filename)).toBe(true);
      });
    });

    test("should handle very long filenames", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      const longFilename = "a".repeat(200) + ".up.sql";
      await adapter.query(
        `INSERT INTO _migrations (filename) VALUES ($1)`, [longFilename]
      );

      const executed = await getExecutedMigrations(adapter);

      expect(executed.size).toBe(1);
      expect(executed.has(longFilename)).toBe(true);
    });
  });

  describe("getLastExecutedMigrations", () => {
    test("should return empty array if no migrations executed", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      const lastExecuted = await getLastExecutedMigrations(adapter);

      expect(Array.isArray(lastExecuted)).toBe(true);
      expect(lastExecuted).toHaveLength(0);
    });

    test("should return all migrations when count is undefined", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      const filenames = [
        "001_first.up.sql",
        "002_second.up.sql",
        "003_third.up.sql"
      ];

      for (const filename of filenames) {
        await adapter.query(
          `INSERT INTO _migrations (filename) VALUES ($1)`, [filename]
        );
      }

      const lastExecuted = await getLastExecutedMigrations(adapter);

      expect(lastExecuted).toHaveLength(3);
      // Should be in reverse order (latest first)
      expect(lastExecuted[0]).toBe("003_third.up.sql");
      expect(lastExecuted[1]).toBe("002_second.up.sql");
      expect(lastExecuted[2]).toBe("001_first.up.sql");
    });

    test("should return specified number of migrations when count provided", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      const filenames = [
        "001_first.up.sql",
        "002_second.up.sql",
        "003_third.up.sql",
        "004_fourth.up.sql"
      ];

      for (const filename of filenames) {
        await adapter.query(
          `INSERT INTO _migrations (filename) VALUES ($1)`, [filename]
        );
      }

      const lastExecuted = await getLastExecutedMigrations(adapter, 2);

      expect(lastExecuted).toHaveLength(2);
      // Should be the last 2 in reverse order
      expect(lastExecuted[0]).toBe("004_fourth.up.sql");
      expect(lastExecuted[1]).toBe("003_third.up.sql");
    });

    test("should return all migrations when count is larger than available", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      const filenames = ["001_first.up.sql", "002_second.up.sql"];

      for (const filename of filenames) {
        await adapter.query(
          `INSERT INTO _migrations (filename) VALUES ($1)`, [filename]
        );
      }

      const lastExecuted = await getLastExecutedMigrations(adapter, 10);

      expect(lastExecuted).toHaveLength(2);
      expect(lastExecuted[0]).toBe("002_second.up.sql");
      expect(lastExecuted[1]).toBe("001_first.up.sql");
    });

    test("should return empty array when count is 0", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      await adapter.query(
        `INSERT INTO _migrations (filename) VALUES ('test.sql')`
      );

      const lastExecuted = await getLastExecutedMigrations(adapter, 0);

      expect(lastExecuted).toHaveLength(0);
    });
  });

  describe("markAsExecuted", () => {
    test("should successfully insert migration record", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      await markAsExecuted(adapter, "test_migration.up.sql");

      const result = await adapter.query(`
        SELECT filename FROM _migrations WHERE filename = 'test_migration.up.sql'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].filename).toBe("test_migration.up.sql");
    });

    test("should fail when trying to insert duplicate filename", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      await markAsExecuted(adapter, "duplicate.up.sql");

      // Should throw error due to UNIQUE constraint
      await expect(
        markAsExecuted(adapter, "duplicate.up.sql")
      ).rejects.toThrow();
    });

    test("should work with TransactionClient", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      await adapter.transaction(async (client) => {
        await markAsExecuted(client, "transaction_test.up.sql");
      });

      const result = await adapter.query(`
        SELECT filename FROM _migrations WHERE filename = 'transaction_test.up.sql'
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].filename).toBe("transaction_test.up.sql");
    });

    test("should handle empty filename", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      await markAsExecuted(adapter, "");

      const result = await adapter.query(`
        SELECT filename FROM _migrations WHERE filename = ''
      `);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].filename).toBe("");
    });
  });

  describe("markAsRolledBack", () => {
    test("should remove a record from _migrations table", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      await markAsExecuted(adapter, "test.sql");
      const beforeRollback = await adapter.query(`
      SELECT EXISTS (
        SELECT FROM _migrations
        WHERE filename = 'test.sql'
      )
    `);
      expect(beforeRollback.rows[0].exists).toBe(true);

      await markAsRolledBack(adapter, "test.sql");
      const afterRollback = await adapter.query(`
      SELECT EXISTS (
        SELECT FROM _migrations
        WHERE filename = 'test.sql'
      )
    `);
      expect(afterRollback.rows[0].exists).toBe(false);
    });

    test("should not error when removing non-existent migration", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      // Should not throw error
      await expect(async () => {
        await markAsRolledBack(adapter, "non_existent.sql");
      }).not.toThrow();

      // Verify it didn't affect other records
      const count = await adapter.query(`
        SELECT COUNT(*) as count FROM _migrations
      `);
      expect(count.rows[0].count).toBe("0");
    });

    test("should work with TransactionClient", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      await markAsExecuted(adapter, "transaction_rollback_test.sql");

      await adapter.transaction(async (client) => {
        await markAsRolledBack(client, "transaction_rollback_test.sql");
      });

      const result = await adapter.query(`
        SELECT EXISTS (
          SELECT FROM _migrations
          WHERE filename = 'transaction_rollback_test.sql'
        )
      `);
      expect(result.rows[0].exists).toBe(false);
    });

    test("should only remove the specific migration", async () => {
      const adapter = createPgAdapter(pool);
      await ensureMigrationsTable(adapter);

      // Add multiple migrations
      await markAsExecuted(adapter, "keep_me.sql");
      await markAsExecuted(adapter, "remove_me.sql");
      await markAsExecuted(adapter, "also_keep_me.sql");

      // Remove only one
      await markAsRolledBack(adapter, "remove_me.sql");

      const remaining = await getExecutedMigrations(adapter);
      expect(remaining.size).toBe(2);
      expect(remaining.has("keep_me.sql")).toBe(true);
      expect(remaining.has("also_keep_me.sql")).toBe(true);
      expect(remaining.has("remove_me.sql")).toBe(false);
    });
  });
});
