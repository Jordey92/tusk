import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { readFile, rm } from "fs/promises";
import { resolve } from "path";
import { Pool } from "pg";
import { createPgAdapter } from "../adapters/pg";
import { cleanupMigrations, createTestPool } from "../utils/test-helper";
import { getCurrentDir } from "../utils/runtime";
import { createInitialMigration } from "./init-migration";
import { ensureMigrationsTable } from "./track-migrations";

const pool = createTestPool();
const adapter = createPgAdapter(pool);
const testMigrationsPath = resolve(getCurrentDir(), "../fixtures/test-migrations");

const readGeneratedMigration = async (
  setupSchema: () => Promise<void>,
  schema: string = "public"
) => {
  await setupSchema();

  const result = await createInitialMigration(adapter, testMigrationsPath, schema);
  const upContent = await readFile(resolve(testMigrationsPath, result.upFile), "utf-8");
  const downContent = await readFile(
    resolve(testMigrationsPath, result.downFile),
    "utf-8"
  );

  return { result, upContent, downContent };
};

const createBasicTables = async (db: Pool) => {
  await db.query(`
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
  beforeEach(async () => {
    await cleanupMigrations(pool);
  });

  afterEach(async () => {
    await rm(testMigrationsPath, { recursive: true, force: true });
  });

  afterAll(async () => {
    await cleanupMigrations(pool);
    await pool.end();
  });

  test("creates initial migration files for a basic schema", async () => {
    const { result } = await readGeneratedMigration(() => createBasicTables(pool));

    expect(result.upFile).toContain("0000000000000_initial.up.sql");
    expect(result.downFile).toContain("0000000000000_initial.down.sql");
    expect(result.tableCount).toBe(2);
    expect(result.markedAsExecuted).toBe(true);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(resolve(testMigrationsPath, result.upFile))).toBe(true);
    expect(existsSync(resolve(testMigrationsPath, result.downFile))).toBe(true);

    const migrationRecord = await pool.query(
      `SELECT checksum FROM _migrations WHERE filename = $1`,
      [result.upFile]
    );

    expect(migrationRecord.rows).toHaveLength(1);
    expect(migrationRecord.rows[0].checksum).toBe(result.checksum);
  });

  test("allows rerunning init when the recorded baseline still matches", async () => {
    const { result } = await readGeneratedMigration(() => createBasicTables(pool));

    const rerunResult = await createInitialMigration(adapter, testMigrationsPath);
    const migrationRecord = await pool.query(
      `SELECT checksum FROM _migrations WHERE filename = $1`,
      [result.upFile]
    );

    expect(rerunResult.checksum).toBe(result.checksum);
    expect(rerunResult.markedAsExecuted).toBe(true);
    expect(migrationRecord.rows).toHaveLength(1);
    expect(migrationRecord.rows[0].checksum).toBe(result.checksum);
  });

  test("adds a checksum to an existing legacy baseline record", async () => {
    await createBasicTables(pool);
    await ensureMigrationsTable(adapter);
    await pool.query(
      `INSERT INTO _migrations (filename) VALUES ('0000000000000_initial.up.sql')`
    );

    const result = await createInitialMigration(adapter, testMigrationsPath);
    const migrationRecord = await pool.query(
      `SELECT checksum FROM _migrations WHERE filename = $1`,
      [result.upFile]
    );

    expect(migrationRecord.rows).toHaveLength(1);
    expect(migrationRecord.rows[0].checksum).toBe(result.checksum);
  });

  test("rejects rerunning init when the recorded baseline would change", async () => {
    const { result, upContent } = await readGeneratedMigration(() =>
      createBasicTables(pool)
    );

    await pool.query(`ALTER TABLE users ADD COLUMN active BOOLEAN DEFAULT true`);

    await expect(
      createInitialMigration(adapter, testMigrationsPath)
    ).rejects.toThrow("already recorded with a different checksum");

    const unchangedUpContent = await readFile(
      resolve(testMigrationsPath, result.upFile),
      "utf-8"
    );

    expect(unchangedUpContent).toBe(upContent);
  });

  test("preserves dependency order in generated up and down migrations", async () => {
    const { upContent, downContent } = await readGeneratedMigration(() =>
      createBasicTables(pool)
    );

    const usersIndex = upContent.indexOf('CREATE TABLE "public"."users"');
    const postsIndex = upContent.indexOf('CREATE TABLE "public"."posts"');
    expect(usersIndex).toBeLessThan(postsIndex);

    const dropPostsIndex = downContent.indexOf(
      'DROP TABLE IF EXISTS "public"."posts"'
    );
    const dropUsersIndex = downContent.indexOf(
      'DROP TABLE IF EXISTS "public"."users"'
    );
    expect(dropPostsIndex).toBeLessThan(dropUsersIndex);
  });

  test("quotes reserved words and mixed-case identifiers", async () => {
    const { upContent } = await readGeneratedMigration(async () => {
      await pool.query(`
        CREATE TABLE public."order" (
          "id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          "select" TEXT NOT NULL,
          "User Name" TEXT
        );
      `);
    });

    expect(upContent).toContain('CREATE TABLE "public"."order"');
    expect(upContent).toContain('"select" TEXT NOT NULL');
    expect(upContent).toContain('"User Name" TEXT');
  });

  test("generates migrations for non-public schemas", async () => {
    const { upContent, downContent, result } = await readGeneratedMigration(
      async () => {
        await pool.query(`
          CREATE SCHEMA "tenant-data";

          CREATE TABLE "tenant-data"."order" (
            id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            description TEXT NOT NULL
          );
        `);
      },
      "tenant-data"
    );

    expect(result.tableCount).toBe(1);
    expect(upContent).toContain('CREATE TABLE "tenant-data"."order"');
    expect(downContent).toContain(
      'DROP TABLE IF EXISTS "tenant-data"."order" CASCADE;'
    );
  });

  test("preserves identity columns from real tables", async () => {
    const { upContent } = await readGeneratedMigration(async () => {
      await pool.query(`
        CREATE TABLE users (
          id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          email TEXT NOT NULL
        );
      `);
    });

    expect(upContent).toContain(
      '"id" INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL'
    );
  });

  test("preserves cross-schema foreign keys", async () => {
    const { upContent } = await readGeneratedMigration(
      async () => {
        await pool.query(`
          CREATE TABLE public.accounts (
            id SERIAL PRIMARY KEY
          );

          CREATE SCHEMA tenant;

          CREATE TABLE tenant.orders (
            id SERIAL PRIMARY KEY,
            account_id INTEGER NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE
          );
        `);
      },
      "tenant"
    );

    expect(upContent).toContain(
      'REFERENCES "public"."accounts"("id") ON DELETE CASCADE'
    );
  });

  test("preserves expression and partial indexes", async () => {
    const { upContent } = await readGeneratedMigration(async () => {
      await pool.query(`
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          deleted_at TIMESTAMPTZ
        );

        CREATE INDEX idx_users_lower_name ON public.users ((lower(name)));
        CREATE INDEX idx_users_active_name ON public.users (name)
        WHERE deleted_at IS NULL;
      `);
    });

    expect(upContent).toContain("CREATE INDEX idx_users_lower_name");
    expect(upContent).toContain("lower(name)");
    expect(upContent).toContain("CREATE INDEX idx_users_active_name");
    expect(upContent).toContain("WHERE (deleted_at IS NULL)");
  });
});
