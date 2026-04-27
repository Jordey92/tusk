import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createPostgresJsAdapter } from "./postgresjs";
import { cleanupMigrations } from "../utils/test-helper";
import type { Pool } from "pg";

const createTestSql = () => {
  // Use connection string to match pg setup exactly
  const connectionString =
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || "user"}:${process.env.DB_PASSWORD || "password"}@${process.env.DB_HOST || "127.0.0.1"}:${process.env.DB_PORT || "5433"}/${process.env.DB_NAME || "migrate_tool_test"}`;

  return postgres(connectionString, {
    max: 1, // Keep pool small for tests
    idle_timeout: 20,
    connect_timeout: 10,
  });
};

const cleanupTestTables = async (sql: postgres.Sql) => {
  await sql`DROP TABLE IF EXISTS comments CASCADE`;
  await sql`DROP TABLE IF EXISTS post_tags CASCADE`;
  await sql`DROP TABLE IF EXISTS posts CASCADE`;
  await sql`DROP TABLE IF EXISTS users CASCADE`;
};

const createTestTables = async (sql: postgres.Sql) => {
  // Clean up first to ensure fresh start
  await cleanupTestTables(sql);

  await sql`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name TEXT,
      age INTEGER,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content TEXT,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      published_at TIMESTAMPTZ
    );
  `;

  await sql`
    CREATE TABLE post_tags (
      post_id INTEGER NOT NULL REFERENCES posts(id),
      tag_name VARCHAR(50) NOT NULL,
      PRIMARY KEY (post_id, tag_name)
    );
  `;

  await sql`
    CREATE TABLE comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id),
      author_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;

  await sql`CREATE INDEX idx_comments_post ON comments(post_id)`;
  await sql`CREATE INDEX idx_comments_author ON comments(author_id)`;
};

describe("PostgresJS Adapter", () => {
  const sql = createTestSql();
  const adapter = createPostgresJsAdapter(sql);

  beforeAll(async () => {
    // Ensure migrations table exists
    const { ensureMigrationsTable } = await import("../core/track-migrations");
    await ensureMigrationsTable(adapter);

    // Clean up any leftover test migration entries from previous runs
    await adapter.query("DELETE FROM _migrations WHERE filename LIKE 'test_%'");

    // Create test tables
    await createTestTables(sql);
  });

  afterAll(async () => {
    // Clean up test-specific migration entries
    await adapter.query("DELETE FROM _migrations WHERE filename LIKE 'test_%'");

    // Clean up test tables
    await cleanupTestTables(sql);

    // Clean up using pg Pool for cleanup helper compatibility
    const { Pool } = await import("pg");
    const pool = new Pool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: parseInt(process.env.DB_PORT || "5433"),
      database: process.env.DB_NAME || "migrate_tool_test",
      user: process.env.DB_USER || "user",
      password: process.env.DB_PASSWORD || "password",
    });
    await cleanupMigrations(pool as Pool);
    await pool.end();
    await sql.end();
  });

  describe("query method", () => {
    test("should execute simple SELECT query", async () => {
      const result = await adapter.query("SELECT 1 as num");

      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].num).toBe(1);
    });

    test("should execute parameterized query", async () => {
      await adapter.query("INSERT INTO users (email, name) VALUES ($1, $2)", [
        "test@example.com",
        "Test User",
      ]);

      const result = await adapter.query(
        "SELECT * FROM users WHERE email = $1",
        ["test@example.com"]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].email).toBe("test@example.com");
      expect(result.rows[0].name).toBe("Test User");

      // Cleanup
      await adapter.query("DELETE FROM users WHERE email = $1", [
        "test@example.com",
      ]);
    });

    test("should handle queries with no results", async () => {
      const result = await adapter.query(
        "SELECT * FROM users WHERE email = $1",
        ["nonexistent@example.com"]
      );

      expect(result.rows.length).toBe(0);
    });

    test("should throw error for invalid SQL", async () => {
      await expect(
        adapter.query("INVALID SQL STATEMENT")
      ).rejects.toThrow();
    });
  });

  describe("transaction method", () => {
    test("should commit transaction on success", async () => {
      await adapter.transaction(async (client) => {
        await client.query("INSERT INTO users (email, name) VALUES ($1, $2)", [
          "transaction@example.com",
          "Transaction User",
        ]);
      });

      const result = await adapter.query(
        "SELECT * FROM users WHERE email = $1",
        ["transaction@example.com"]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].email).toBe("transaction@example.com");

      // Cleanup
      await adapter.query("DELETE FROM users WHERE email = $1", [
        "transaction@example.com",
      ]);
    });

    test("should rollback transaction on error", async () => {
      await expect(
        adapter.transaction(async (client) => {
          await client.query(
            "INSERT INTO users (email, name) VALUES ($1, $2)",
            ["rollback@example.com", "Rollback User"]
          );
          throw new Error("Intentional error");
        })
      ).rejects.toThrow("Intentional error");

      const result = await adapter.query(
        "SELECT * FROM users WHERE email = $1",
        ["rollback@example.com"]
      );

      expect(result.rows.length).toBe(0);
    });

    test("should handle multiple operations in transaction", async () => {
      await adapter.transaction(async (client) => {
        await client.query("INSERT INTO users (email, name) VALUES ($1, $2)", [
          "multi1@example.com",
          "Multi User 1",
        ]);
        await client.query("INSERT INTO users (email, name) VALUES ($1, $2)", [
          "multi2@example.com",
          "Multi User 2",
        ]);
      });

      const result1 = await adapter.query(
        "SELECT * FROM users WHERE email = $1",
        ["multi1@example.com"]
      );
      const result2 = await adapter.query(
        "SELECT * FROM users WHERE email = $1",
        ["multi2@example.com"]
      );

      expect(result1.rows.length).toBe(1);
      expect(result2.rows.length).toBe(1);

      // Cleanup
      await adapter.query("DELETE FROM users WHERE email LIKE 'multi%'");
    });

    test("should return value from transaction", async () => {
      const userId = await adapter.transaction(async (client) => {
        const result = await client.query(
          "INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id",
          ["return@example.com", "Return User"]
        );
        return result.rows[0].id;
      });

      expect(userId).toBeDefined();
      expect(typeof userId).toBe("number");

      // Cleanup
      await adapter.query("DELETE FROM users WHERE email = $1", [
        "return@example.com",
      ]);
    });
  });

  describe("introspection methods", () => {
    test("should get table names", async () => {
      const tables = await adapter.getTableNames("public");

      expect(Array.isArray(tables)).toBe(true);
      expect(tables.length).toBeGreaterThan(0);
      expect(tables).toContain("users");
      expect(tables).toContain("posts");
      expect(tables).toContain("comments");
      expect(tables).not.toContain("_migrations");
    });

    test("should get table columns", async () => {
      const columns = await adapter.getTableColumns("users");

      expect(columns.length).toBeGreaterThan(0);

      const idColumn = columns.find((c) => c.name === "id");
      expect(idColumn).toBeDefined();
      expect(idColumn?.type).toBe("integer");
      expect(idColumn?.isNullable).toBe(false);

      const emailColumn = columns.find((c) => c.name === "email");
      expect(emailColumn).toBeDefined();
      expect(emailColumn?.type).toBe("character varying");
      expect(emailColumn?.characterMaximumLength).toBe(255);
    });

    test("should get primary keys", async () => {
      const pks = await adapter.getPrimaryKeys("users");

      expect(pks).toHaveLength(1);
      expect(pks[0].columnName).toBe("id");
      expect(pks[0].position).toBe(1);
    });

    test("should get composite primary keys", async () => {
      const pks = await adapter.getPrimaryKeys("post_tags");

      expect(pks).toHaveLength(2);
      expect(pks[0].columnName).toBe("post_id");
      expect(pks[1].columnName).toBe("tag_name");
    });

    test("should get foreign keys", async () => {
      const fks = await adapter.getForeignKeys("posts");

      expect(fks.length).toBeGreaterThan(0);

      const authorFk = fks.find((fk) => fk.columnName === "author_id");
      expect(authorFk).toBeDefined();
      expect(authorFk?.foreignTableName).toBe("users");
      expect(authorFk?.foreignColumnName).toBe("id");
      expect(authorFk?.deleteRule).toBe("CASCADE");
    });

    test("should get unique constraints", async () => {
      const uniques = await adapter.getUniqueConstraints("users");

      expect(uniques.length).toBeGreaterThan(0);

      const emailUnique = uniques.find((u) => u.columnNames.includes("email"));
      expect(emailUnique).toBeDefined();
      expect(emailUnique?.columnNames).toEqual(["email"]);
    });

    test("should get indexes", async () => {
      const indexes = await adapter.getIndexes("comments");

      expect(indexes.length).toBeGreaterThan(0);

      const postIndex = indexes.find(
        (idx) => idx.indexName === "idx_comments_post"
      );
      expect(postIndex).toBeDefined();
      expect(postIndex?.indexDefinition).toContain("post_id");
    });

    test("should introspect full table", async () => {
      const tableInfo = await adapter.introspectTable("users");

      expect(tableInfo.name).toBe("users");
      expect(tableInfo.columns.length).toBeGreaterThan(0);
      expect(tableInfo.primaryKeys.length).toBe(1);
      expect(tableInfo.foreignKeys).toHaveLength(0);
      expect(tableInfo.uniqueConstraints.length).toBeGreaterThan(0);
    });

    test("should introspect full database", async () => {
      const schema = await adapter.introspectDatabase("public");

      expect(schema.tables.length).toBeGreaterThan(0);

      const tableNames = schema.tables.map((t) => t.name);
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("posts");
      expect(tableNames).toContain("comments");
      expect(tableNames).not.toContain("_migrations");
    });
  });

  describe("DDL generation methods", () => {
    test("should generate CREATE TABLE SQL", () => {
      const table = {
        name: "test_table",
        columns: [
          {
            name: "id",
            type: "integer",
            isNullable: false,
            defaultValue: "nextval('test_table_id_seq'::regclass)",
            characterMaximumLength: null,
            numericPrecision: null,
            numericScale: null,
            udtName: "int4",
          },
          {
            name: "name",
            type: "character varying",
            isNullable: false,
            defaultValue: null,
            characterMaximumLength: 255,
            numericPrecision: null,
            numericScale: null,
            udtName: "varchar",
          },
        ],
        primaryKeys: [{ columnName: "id", position: 1 }],
        foreignKeys: [],
        uniqueConstraints: [],
        indexes: [],
      };

      const sql = adapter.generateCreateTable(table);
      expect(sql).toContain("CREATE TABLE \"test_table\"");
      expect(sql).toContain("\"id\" SERIAL");
      expect(sql).toContain("\"name\" VARCHAR(255) NOT NULL");
      expect(sql).toContain("PRIMARY KEY (\"id\")");
    });

    test("should generate DROP TABLE SQL", () => {
      const sql = adapter.generateDropTable("test_table");
      expect(sql).toBe("DROP TABLE IF EXISTS \"test_table\" CASCADE;");
    });

    test("should sort tables by dependencies", () => {
      const tables = [
        {
          name: "posts",
          columns: [],
          primaryKeys: [],
          foreignKeys: [
            {
              columnName: "author_id",
              foreignTableName: "users",
              foreignColumnName: "id",
              updateRule: "NO ACTION",
              deleteRule: "CASCADE",
              constraintName: "posts_author_id_fkey",
            },
          ],
          uniqueConstraints: [],
          indexes: [],
        },
        {
          name: "users",
          columns: [],
          primaryKeys: [],
          foreignKeys: [],
          uniqueConstraints: [],
          indexes: [],
        },
      ];

      const sorted = adapter.sortTablesByDependencies(tables);
      expect(sorted[0].name).toBe("users");
      expect(sorted[1].name).toBe("posts");
    });
  });

  describe("integration with migration functions", () => {
    test("should work with ensureMigrationsTable", async () => {
      const { ensureMigrationsTable } = await import(
        "../core/track-migrations"
      );
      await ensureMigrationsTable(adapter);

      const result = await adapter.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = '_migrations'
        )
      `);
      expect(result.rows[0].exists).toBe(true);
    });

    test("should work with markAsExecuted and getExecutedMigrations", async () => {
      const { markAsExecuted, getExecutedMigrations } = await import(
        "../core/track-migrations"
      );

      await markAsExecuted(adapter, "test_postgresjs.up.sql");

      const executed = await getExecutedMigrations(adapter);
      expect(executed.has("test_postgresjs.up.sql")).toBe(true);
    });

    test("should work with markAsRolledBack", async () => {
      const { markAsExecuted, markAsRolledBack, getExecutedMigrations } =
        await import("../core/track-migrations");

      await markAsExecuted(adapter, "test_rollback.up.sql");

      let executed = await getExecutedMigrations(adapter);
      expect(executed.has("test_rollback.up.sql")).toBe(true);

      await markAsRolledBack(adapter, "test_rollback.up.sql");

      executed = await getExecutedMigrations(adapter);
      expect(executed.has("test_rollback.up.sql")).toBe(false);
    });
  });

  describe("migration locks", () => {
    test("should have migration lock methods from pg adapter", () => {
      // Verify that the locking methods are present from pg adapter delegation
      expect(typeof adapter.acquireMigrationLock).toBe("function");
      expect(typeof adapter.releaseMigrationLock).toBe("function");
    });
  });
});
