import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresAdapter } from "../adapters/postgres";
import { cleanupMigrations, createTestPool } from "../utils/test-helper";
import {
  getTableNames,
  getTableColumns,
  getPrimaryKeys,
  getForeignKeys,
  getUniqueConstraints,
  getIndexes,
  introspectTable,
  introspectDatabase,
} from "./introspect-schema";

const createTestTables = async (pool) => {
  await pool.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name TEXT,
      age INTEGER,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content TEXT,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      published_at TIMESTAMPTZ
    );

    CREATE TABLE post_tags (
      post_id INTEGER NOT NULL REFERENCES posts(id),
      tag_name VARCHAR(50) NOT NULL,
      PRIMARY KEY (post_id, tag_name)
    );

    CREATE TABLE comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id),
      author_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX idx_comments_post ON comments(post_id);
    CREATE INDEX idx_comments_author ON comments(author_id);
  `);
};

describe("introspect schema", () => {
  const pool = createTestPool();
  const adapter = createPostgresAdapter(pool);

  beforeAll(async () => {
    await cleanupMigrations(pool);
    await createTestTables(pool);
  });

  afterAll(async () => {
    await cleanupMigrations(pool);
  });

  describe("getTableNames", () => {
    test("should return list of user tables excluding tusk_migrations", async () => {
      const tables = await getTableNames(adapter, "public");

      expect(Array.isArray(tables)).toBe(true);
      expect(tables.length).toBeGreaterThan(0);
      expect(tables).toContain("users");
      expect(tables).toContain("posts");
      expect(tables).toContain("comments");
      expect(tables).toContain("post_tags");
      expect(tables).not.toContain("_migrations");
    });

    test("should return tables in alphabetical order", async () => {
      const tables = await getTableNames(adapter, "public");

      const sorted = [...tables].sort();
      expect(tables).toEqual(sorted);
    });
  });

  describe("getTableColumns", () => {
    test("should return column information for users table", async () => {
      const columns = await getTableColumns(adapter, "users");

      expect(columns.length).toBeGreaterThan(0);

      const idColumn = columns.find((c) => c.name === "id");
      expect(idColumn).toBeDefined();
      expect(idColumn?.type).toBe("integer");
      expect(idColumn?.isNullable).toBe(false);
      expect(idColumn?.defaultValue).toContain("nextval");

      const emailColumn = columns.find((c) => c.name === "email");
      expect(emailColumn).toBeDefined();
      expect(emailColumn?.type).toBe("character varying");
      expect(emailColumn?.isNullable).toBe(false);
      expect(emailColumn?.characterMaximumLength).toBe(255);

      const nameColumn = columns.find((c) => c.name === "name");
      expect(nameColumn).toBeDefined();
      expect(nameColumn?.type).toBe("text");
      expect(nameColumn?.isNullable).toBe(true);
    });

    test("should return columns in ordinal position order", async () => {
      const columns = await getTableColumns(adapter, "users");

      expect(columns[0].name).toBe("id");
      expect(columns[1].name).toBe("email");
    });

    test("should handle different column types in posts table", async () => {
      const columns = await getTableColumns(adapter, "posts");

      const timestampColumn = columns.find((c) => c.name === "published_at");
      expect(timestampColumn).toBeDefined();
      expect(timestampColumn?.type).toBe("timestamp with time zone");
    });
  });

  describe("getPrimaryKeys", () => {
    test("should return primary key for users table", async () => {
      const pks = await getPrimaryKeys(adapter, "users");

      expect(pks).toHaveLength(1);
      expect(pks[0].columnName).toBe("id");
      expect(pks[0].position).toBe(1);
    });

    test("should return composite primary key for post_tags table", async () => {
      const pks = await getPrimaryKeys(adapter, "post_tags");

      expect(pks).toHaveLength(2);
      expect(pks[0].columnName).toBe("post_id");
      expect(pks[0].position).toBe(1);
      expect(pks[1].columnName).toBe("tag_name");
      expect(pks[1].position).toBe(2);
    });

    test("should return empty array for table without primary key", async () => {
      // Create a temp table without PK for testing
      await adapter.query(`
        CREATE TEMPORARY TABLE temp_no_pk (
          id INTEGER,
          name TEXT
        )
      `);

      const pks = await getPrimaryKeys(adapter, "temp_no_pk");
      expect(pks).toHaveLength(0);
    });
  });

  describe("getForeignKeys", () => {
    test("should return foreign keys for posts table", async () => {
      const fks = await getForeignKeys(adapter, "posts");

      expect(fks.length).toBeGreaterThan(0);

      const authorFk = fks.find((fk) => fk.columnName === "author_id");
      expect(authorFk).toBeDefined();
      expect(authorFk?.foreignTableName).toBe("users");
      expect(authorFk?.foreignColumnName).toBe("id");
      expect(authorFk?.deleteRule).toBe("CASCADE");
    });

    test("should return multiple foreign keys for comments table", async () => {
      const fks = await getForeignKeys(adapter, "comments");

      expect(fks.length).toBe(2);

      const postFk = fks.find((fk) => fk.columnName === "post_id");
      expect(postFk).toBeDefined();
      expect(postFk?.foreignTableName).toBe("posts");

      const authorFk = fks.find((fk) => fk.columnName === "author_id");
      expect(authorFk).toBeDefined();
      expect(authorFk?.foreignTableName).toBe("users");
    });

    test("should return empty array for table without foreign keys", async () => {
      const fks = await getForeignKeys(adapter, "users");

      expect(fks).toHaveLength(0);
    });
  });

  describe("getUniqueConstraints", () => {
    test("should return unique constraint for users email", async () => {
      const uniques = await getUniqueConstraints(adapter, "users");

      expect(uniques.length).toBeGreaterThan(0);

      const emailUnique = uniques.find((u) => u.columnNames.includes("email"));
      expect(emailUnique).toBeDefined();
      expect(emailUnique?.columnNames).toEqual(["email"]);
    });

    test("should return empty array for table without unique constraints", async () => {
      const uniques = await getUniqueConstraints(adapter, "comments");

      expect(uniques).toHaveLength(0);
    });
  });

  describe("getIndexes", () => {
    test("should return indexes for comments table", async () => {
      const indexes = await getIndexes(adapter, "comments");

      expect(indexes.length).toBeGreaterThan(0);

      const postIndex = indexes.find((idx) => idx.indexName === "idx_comments_post");
      expect(postIndex).toBeDefined();
      expect(postIndex?.indexDefinition).toContain("post_id");

      const authorIndex = indexes.find((idx) => idx.indexName === "idx_comments_author");
      expect(authorIndex).toBeDefined();
      expect(authorIndex?.indexDefinition).toContain("author_id");
    });

    test("should not return primary key indexes", async () => {
      const indexes = await getIndexes(adapter, "users");

      const pkeyIndex = indexes.find((idx) => idx.indexName.includes("_pkey"));
      expect(pkeyIndex).toBeUndefined();
    });
  });

  describe("introspectTable", () => {
    test("should return complete table information for users", async () => {
      const tableInfo = await introspectTable(adapter, "users");

      expect(tableInfo.name).toBe("users");
      expect(tableInfo.columns.length).toBeGreaterThan(0);
      expect(tableInfo.primaryKeys.length).toBe(1);
      expect(tableInfo.foreignKeys).toHaveLength(0);
      expect(tableInfo.uniqueConstraints.length).toBeGreaterThan(0);
    });

    test("should return complete table information for posts with foreign keys", async () => {
      const tableInfo = await introspectTable(adapter, "posts");

      expect(tableInfo.name).toBe("posts");
      expect(tableInfo.columns.length).toBeGreaterThan(0);
      expect(tableInfo.primaryKeys.length).toBe(1);
      expect(tableInfo.foreignKeys.length).toBe(1);
    });

    test("should return complete table information for post_tags with composite PK", async () => {
      const tableInfo = await introspectTable(adapter, "post_tags");

      expect(tableInfo.name).toBe("post_tags");
      expect(tableInfo.primaryKeys.length).toBe(2);
      expect(tableInfo.foreignKeys.length).toBe(1);
    });
  });

  describe("introspectDatabase", () => {
    test("should return all tables in the database", async () => {
      const schema = await introspectDatabase(adapter, "public");

      expect(schema.tables.length).toBeGreaterThan(0);

      const tableNames = schema.tables.map((t) => t.name);
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("posts");
      expect(tableNames).toContain("comments");
      expect(tableNames).toContain("post_tags");
      expect(tableNames).not.toContain("_migrations");
    });

    test("should return complete information for all tables", async () => {
      const schema = await introspectDatabase(adapter, "public");

      for (const table of schema.tables) {
        expect(table.name).toBeDefined();
        expect(Array.isArray(table.columns)).toBe(true);
        expect(Array.isArray(table.primaryKeys)).toBe(true);
        expect(Array.isArray(table.foreignKeys)).toBe(true);
        expect(Array.isArray(table.uniqueConstraints)).toBe(true);
        expect(Array.isArray(table.indexes)).toBe(true);
      }
    });

    test("should default to public schema when schema not provided", async () => {
      const schema = await introspectDatabase(adapter);

      expect(schema.tables.length).toBeGreaterThan(0);
    });
  });
});
