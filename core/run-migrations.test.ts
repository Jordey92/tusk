import { afterEach, describe, expect, test } from "bun:test";
import { cleanupMigrations, createTestPool } from "../utils/test-helper";
import { createPgAdapter } from "../adapters/pg";
import { runDown, runUp } from "./run-migrations";
import { getExecutedMigrations } from "./track-migrations";

describe("run migrations", () => {
  const pool = createTestPool();
  const adapter = createPgAdapter(pool);
  afterEach(async () => {
    await cleanupMigrations(pool);
  });

  describe("runUp", () => {
    test("should run up migrations", async () => {
      await runUp(adapter, "./fixtures/migrations");

      const executed = await getExecutedMigrations(adapter);
      expect(executed.size).toBeGreaterThan(0);
    });

    test("should return correct RunResult with executed and pending counts", async () => {
      const result = await runUp(adapter, "./fixtures/migrations");

      expect(result).toHaveProperty("executed");
      expect(result).toHaveProperty("pending");
      expect(typeof result.executed).toBe("number");
      expect(typeof result.pending).toBe("number");
      expect(result.executed).toBeGreaterThan(0);
      expect(result.pending).toBe(0); // All pending should be executed
    });

    test("should not run already executed migrations", async () => {
      // Run migrations once
      const firstRun = await runUp(adapter, "./fixtures/migrations");
      expect(firstRun.executed).toBeGreaterThan(0);

      // Run again - should execute 0 new migrations
      const secondRun = await runUp(adapter, "./fixtures/migrations");
      expect(secondRun.executed).toBe(0);
      expect(secondRun.pending).toBe(0);
    });

    test("should handle empty migrations directory", async () => {
      // Create empty temporary directory
      const { mkdtemp, rmdir } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-empty-"));

      try {
        const result = await runUp(adapter, tempDir);
        expect(result.executed).toBe(0);
        expect(result.pending).toBe(0);
      } finally {
        await rmdir(tempDir);
      }
    });

    test("should handle directory with no .up.sql files", async () => {
      // Create temporary directory with non-migration files
      const { mkdtemp, rmdir, writeFile, unlink } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-no-up-"));
      const downFile = join(tempDir, "123_test.down.sql");
      const textFile = join(tempDir, "readme.txt");

      try {
        await writeFile(downFile, "DROP TABLE test;");
        await writeFile(textFile, "Not a migration");

        const result = await runUp(adapter, tempDir);
        expect(result.executed).toBe(0);
        expect(result.pending).toBe(0);
      } finally {
        await unlink(downFile);
        await unlink(textFile);
        await rmdir(tempDir);
      }
    });

    test("should throw error for non-existent migrations directory", async () => {
      await expect(
        runUp(adapter, "./non-existent-directory")
      ).rejects.toThrow("Migrations directory not found");
    });

    test("should throw error when migration SQL fails", async () => {
      // Create temporary directory with invalid SQL
      const { mkdtemp, rmdir, writeFile, unlink } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-bad-sql-"));
      const badSqlFile = join(tempDir, "123_bad_sql.up.sql");

      try {
        await writeFile(badSqlFile, "INVALID SQL STATEMENT;");

        await expect(
          runUp(adapter, tempDir)
        ).rejects.toThrow("Migration failed: 123_bad_sql.up.sql");
      } finally {
        try {
          await unlink(badSqlFile);
        } catch {}
        await rmdir(tempDir);
      }
    });

    test("should not mark migration as executed if SQL fails", async () => {
      // Create temporary directory with invalid SQL
      const { mkdtemp, rmdir, writeFile, unlink } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-rollback-"));
      const badSqlFile = join(tempDir, "123_should_rollback.up.sql");

      try {
        await writeFile(badSqlFile, "INVALID SQL STATEMENT;");

        try {
          await runUp(adapter, tempDir);
        } catch (error) {
          // Expected to fail
        }

        // Verify migration was not marked as executed
        const executed = await getExecutedMigrations(adapter);
        expect(executed.has("123_should_rollback.up.sql")).toBe(false);
      } finally {
        try {
          await unlink(badSqlFile);
        } catch {}
        await rmdir(tempDir);
      }
    });
  });

  describe("runDown", () => {
    test("should run down all migrations", async () => {
      await runUp(adapter, "./fixtures/migrations");

      const beforeRollback = await getExecutedMigrations(adapter);
      expect(beforeRollback.size).toBeGreaterThan(0);

      await runDown(adapter, "./fixtures/migrations");

      const executed = await getExecutedMigrations(adapter);
      expect(executed.size).toBe(0);
    });

    test("should run down n migrations", async () => {
      await runUp(adapter, "./fixtures/migrations");

      const beforeRollback = await getExecutedMigrations(adapter);
      const totalCount = beforeRollback.size;

      // Roll back just 1
      await runDown(adapter, "./fixtures/migrations", 1);

      const afterRollback = await getExecutedMigrations(adapter);
      expect(afterRollback.size).toBe(totalCount - 1);
    });

    test("should return correct RunResult with executed and pending counts", async () => {
      await runUp(adapter, "./fixtures/migrations");

      const result = await runDown(adapter, "./fixtures/migrations");

      expect(result).toHaveProperty("executed");
      expect(result).toHaveProperty("pending");
      expect(typeof result.executed).toBe("number");
      expect(typeof result.pending).toBe("number");
      expect(result.executed).toBeGreaterThan(0);
      expect(result.pending).toBe(0); // All should be rolled back
    });

    test("should handle count parameter of 0", async () => {
      await runUp(adapter, "./fixtures/migrations");

      const result = await runDown(adapter, "./fixtures/migrations", 0);

      expect(result.executed).toBe(0);
      expect(result.pending).toBe(0);

      // Verify no migrations were rolled back
      const executed = await getExecutedMigrations(adapter);
      expect(executed.size).toBeGreaterThan(0);
    });

    test("should handle count larger than available migrations", async () => {
      await runUp(adapter, "./fixtures/migrations");
      const beforeRollback = await getExecutedMigrations(adapter);
      const totalCount = beforeRollback.size;

      const result = await runDown(adapter, "./fixtures/migrations", totalCount + 10);

      expect(result.executed).toBe(totalCount);
      expect(result.pending).toBe(0);

      // Verify all migrations were rolled back
      const executed = await getExecutedMigrations(adapter);
      expect(executed.size).toBe(0);
    });

    test("should handle no executed migrations to rollback", async () => {
      // Don't run any migrations first
      const result = await runDown(adapter, "./fixtures/migrations");

      expect(result.executed).toBe(0);
      expect(result.pending).toBe(0);
    });

    test("should handle missing down files gracefully", async () => {
      // Create temporary directory with up file but no corresponding down file
      const { mkdtemp, rmdir, writeFile, unlink } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-missing-down-"));
      const upFile = join(tempDir, "123_test.up.sql");

      try {
        await writeFile(upFile, "CREATE TABLE test_missing_down (id INT);");

        // Run up migration
        await runUp(adapter, tempDir);

        await expect(runDown(adapter, tempDir)).rejects.toThrow(
          "Missing rollback migration file"
        );

      } finally {
        await unlink(upFile);
        await rmdir(tempDir);
      }
    });

    test("should throw error for non-existent migrations directory", async () => {
      await expect(
        runDown(adapter, "./non-existent-directory")
      ).rejects.toThrow("Migrations directory not found");
    });

    test("should throw error when rollback SQL fails", async () => {
      // Create temporary directory with good up file and bad down file
      const { mkdtemp, rmdir, writeFile, unlink } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-bad-down-"));
      const upFile = join(tempDir, "123_bad_down.up.sql");
      const downFile = join(tempDir, "123_bad_down.down.sql");

      try {
        await writeFile(upFile, "CREATE TABLE test_bad_down (id INT);");
        await writeFile(downFile, "INVALID SQL FOR ROLLBACK;");

        // Run up migration
        await runUp(adapter, tempDir);

        // Try to run down - should fail
        await expect(
          runDown(adapter, tempDir)
        ).rejects.toThrow("Rollback failed: 123_bad_down.down.sql");

      } finally {
        try {
          await unlink(upFile);
          await unlink(downFile);
        } catch {}
        await rmdir(tempDir);
      }
    });

    test("should not mark migration as rolled back if rollback SQL fails", async () => {
      // Create temporary directory with good up file and bad down file
      const { mkdtemp, rmdir, writeFile, unlink } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-rollback-fail-"));
      const upFile = join(tempDir, "123_rollback_fail.up.sql");
      const downFile = join(tempDir, "123_rollback_fail.down.sql");

      try {
        await writeFile(upFile, "CREATE TABLE test_rollback_fail (id INT);");
        await writeFile(downFile, "INVALID SQL FOR ROLLBACK;");

        // Run up migration
        await runUp(adapter, tempDir);

        // Verify migration is executed
        let executed = await getExecutedMigrations(adapter);
        expect(executed.has("123_rollback_fail.up.sql")).toBe(true);

        // Try to run down - should fail and leave migration marked as executed
        try {
          await runDown(adapter, tempDir);
        } catch (error) {
          // Expected to fail
        }

        // Verify migration is still marked as executed (rollback failed)
        executed = await getExecutedMigrations(adapter);
        expect(executed.has("123_rollback_fail.up.sql")).toBe(true);

      } finally {
        try {
          await unlink(upFile);
          await unlink(downFile);
        } catch {}
        await rmdir(tempDir);
      }
    });

    test("should handle partial rollback count correctly", async () => {
      await runUp(adapter, "./fixtures/migrations");

      const beforeRollback = await getExecutedMigrations(adapter);
      const totalCount = beforeRollback.size;

      // If we have multiple migrations, test rolling back a subset
      if (totalCount > 1) {
        const countToRollback = Math.floor(totalCount / 2);
        const result = await runDown(adapter, "./fixtures/migrations", countToRollback);

        expect(result.executed).toBe(countToRollback);
        expect(result.pending).toBe(0);

        const afterRollback = await getExecutedMigrations(adapter);
        expect(afterRollback.size).toBe(totalCount - countToRollback);
      }
    });

    test("should rollback in reverse execution order to respect dependencies", async () => {
      const { mkdtemp, rm, writeFile } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-order-"));

      const upUsers = join(tempDir, "100_create_users.up.sql");
      const downUsers = join(tempDir, "100_create_users.down.sql");
      const upPosts = join(tempDir, "200_create_posts.up.sql");
      const downPosts = join(tempDir, "200_create_posts.down.sql");

      try {
        await writeFile(
          upUsers,
          "CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL);"
        );
        await writeFile(
          downUsers,
          "DROP TABLE users;"
        );
        await writeFile(
          upPosts,
          "CREATE TABLE posts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id));"
        );
        await writeFile(
          downPosts,
          "DROP TABLE posts;"
        );

        await runUp(adapter, tempDir);

        const result = await runDown(adapter, tempDir, 2);
        expect(result.executed).toBe(2);
        expect(result.pending).toBe(0);
      } finally {
        await adapter.query("DROP TABLE IF EXISTS posts CASCADE;");
        await adapter.query("DROP TABLE IF EXISTS users CASCADE;");
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
