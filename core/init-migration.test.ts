import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { readFile, rm } from "fs/promises";
import { resolve } from "path";
import { createPostgresAdapter } from "../adapters/postgres";
import { cleanupMigrations, createTestPool } from "../utils/test-helper";
import { getCurrentDir } from "../utils/runtime";
import { createInitialMigration } from "./init-migration";

const createTestTables = async (pool) => {
  await pool.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name TEXT
    );

    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
  `);
};

describe("init migration", () => {
  const pool = createTestPool();
  const adapter = createPostgresAdapter(pool);
  const testMigrationsPath = resolve(getCurrentDir(), "../fixtures/test-migrations");

  beforeAll(async () => {
    await cleanupMigrations(pool);
    await createTestTables(pool);
  });

  afterAll(async () => {
    await cleanupMigrations(pool);
    // Clean up test migration files
    try {
      await rm(testMigrationsPath, { recursive: true, force: true });
    } catch {}
  });

  describe("createInitialMigration", () => {
    test("should create initial migration files", async () => {
      const result = await createInitialMigration(adapter, testMigrationsPath);

      expect(result.upFile).toContain("0000000000000_initial.up.sql");
      expect(result.downFile).toContain("0000000000000_initial.down.sql");
      expect(result.tableCount).toBe(2);

      // Check files exist
      expect(existsSync(resolve(testMigrationsPath, result.upFile))).toBe(true);
      expect(existsSync(resolve(testMigrationsPath, result.downFile))).toBe(true);
    });

    test("should create UP migration with CREATE TABLE statements", async () => {
      const result = await createInitialMigration(adapter, testMigrationsPath);

      const upContent = await readFile(resolve(testMigrationsPath, result.upFile), "utf-8");

      expect(upContent).toContain("CREATE TABLE users");
      expect(upContent).toContain("CREATE TABLE posts");
      expect(upContent).toContain("PRIMARY KEY");
      expect(upContent).toContain("FOREIGN KEY");
    });

    test("should create DOWN migration with DROP TABLE statements", async () => {
      const result = await createInitialMigration(adapter, testMigrationsPath);

      const downContent = await readFile(resolve(testMigrationsPath, result.downFile), "utf-8");

      expect(downContent).toContain("DROP TABLE IF EXISTS posts");
      expect(downContent).toContain("DROP TABLE IF EXISTS users");
    });

    test("should create tables in dependency order in UP migration", async () => {
      const result = await createInitialMigration(adapter, testMigrationsPath);

      const upContent = await readFile(resolve(testMigrationsPath, result.upFile), "utf-8");

      const usersIndex = upContent.indexOf("CREATE TABLE users");
      const postsIndex = upContent.indexOf("CREATE TABLE posts");

      expect(usersIndex).toBeLessThan(postsIndex);
    });

    test("should drop tables in reverse dependency order in DOWN migration", async () => {
      const result = await createInitialMigration(adapter, testMigrationsPath);

      const downContent = await readFile(resolve(testMigrationsPath, result.downFile), "utf-8");

      const postsIndex = downContent.indexOf("DROP TABLE IF EXISTS posts");
      const usersIndex = downContent.indexOf("DROP TABLE IF EXISTS users");

      expect(postsIndex).toBeLessThan(usersIndex);
    });
  });
});
