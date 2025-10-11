import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresAdapter } from "./postgres";
import { cleanupMigrations, createTestPool } from "../utils/test-helper";
import { Pool } from "pg";
import type { ColumnInfo, TableInfo, IntrospectedSchema } from "../types/schema";

const createTestTables = async (pool: Pool) => {
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

describe("PostgreSQL Adapter", () => {
  const pool = createTestPool();
  const adapter = createPostgresAdapter(pool);

  beforeAll(async () => {
    await cleanupMigrations(pool);
    await createTestTables(pool);
  });

  afterAll(async () => {
    await cleanupMigrations(pool);
  });

  describe("introspect schema", () => {
    describe("getTableNames", () => {
      test("should return list of user tables excluding tusk_migrations", async () => {
        const tables = await adapter.getTableNames("public");

        expect(Array.isArray(tables)).toBe(true);
        expect(tables.length).toBeGreaterThan(0);
        expect(tables).toContain("users");
        expect(tables).toContain("posts");
        expect(tables).toContain("comments");
        expect(tables).toContain("post_tags");
        expect(tables).not.toContain("_migrations");
      });

      test("should return tables in alphabetical order", async () => {
        const tables = await adapter.getTableNames("public");

        const sorted = [...tables].sort();
        expect(tables).toEqual(sorted);
      });
    });

    describe("getTableColumns", () => {
      test("should return column information for users table", async () => {
        const columns = await adapter.getTableColumns("users");

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
        const columns = await adapter.getTableColumns("users");

        expect(columns[0].name).toBe("id");
        expect(columns[1].name).toBe("email");
      });

      test("should handle different column types in posts table", async () => {
        const columns = await adapter.getTableColumns("posts");

        const timestampColumn = columns.find((c) => c.name === "published_at");
        expect(timestampColumn).toBeDefined();
        expect(timestampColumn?.type).toBe("timestamp with time zone");
      });
    });

    describe("getPrimaryKeys", () => {
      test("should return primary key for users table", async () => {
        const pks = await adapter.getPrimaryKeys("users");

        expect(pks).toHaveLength(1);
        expect(pks[0].columnName).toBe("id");
        expect(pks[0].position).toBe(1);
      });

      test("should return composite primary key for post_tags table", async () => {
        const pks = await adapter.getPrimaryKeys("post_tags");

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

        const pks = await adapter.getPrimaryKeys("temp_no_pk");
        expect(pks).toHaveLength(0);
      });
    });

    describe("getForeignKeys", () => {
      test("should return foreign keys for posts table", async () => {
        const fks = await adapter.getForeignKeys("posts");

        expect(fks.length).toBeGreaterThan(0);

        const authorFk = fks.find((fk) => fk.columnName === "author_id");
        expect(authorFk).toBeDefined();
        expect(authorFk?.foreignTableName).toBe("users");
        expect(authorFk?.foreignColumnName).toBe("id");
        expect(authorFk?.deleteRule).toBe("CASCADE");
      });

      test("should return multiple foreign keys for comments table", async () => {
        const fks = await adapter.getForeignKeys("comments");

        expect(fks.length).toBe(2);

        const postFk = fks.find((fk) => fk.columnName === "post_id");
        expect(postFk).toBeDefined();
        expect(postFk?.foreignTableName).toBe("posts");

        const authorFk = fks.find((fk) => fk.columnName === "author_id");
        expect(authorFk).toBeDefined();
        expect(authorFk?.foreignTableName).toBe("users");
      });

      test("should return empty array for table without foreign keys", async () => {
        const fks = await adapter.getForeignKeys("users");

        expect(fks).toHaveLength(0);
      });
    });

    describe("getUniqueConstraints", () => {
      test("should return unique constraint for users email", async () => {
        const uniques = await adapter.getUniqueConstraints("users");

        expect(uniques.length).toBeGreaterThan(0);

        const emailUnique = uniques.find((u) => u.columnNames.includes("email"));
        expect(emailUnique).toBeDefined();
        expect(emailUnique?.columnNames).toEqual(["email"]);
      });

      test("should return empty array for table without unique constraints", async () => {
        const uniques = await adapter.getUniqueConstraints("comments");

        expect(uniques).toHaveLength(0);
      });
    });

    describe("getIndexes", () => {
      test("should return indexes for comments table", async () => {
        const indexes = await adapter.getIndexes("comments");

        expect(indexes.length).toBeGreaterThan(0);

        const postIndex = indexes.find(
          (idx) => idx.indexName === "idx_comments_post"
        );
        expect(postIndex).toBeDefined();
        expect(postIndex?.indexDefinition).toContain("post_id");

        const authorIndex = indexes.find(
          (idx) => idx.indexName === "idx_comments_author"
        );
        expect(authorIndex).toBeDefined();
        expect(authorIndex?.indexDefinition).toContain("author_id");
      });

      test("should not return primary key indexes", async () => {
        const indexes = await adapter.getIndexes("users");

        const pkeyIndex = indexes.find((idx) => idx.indexName.includes("_pkey"));
        expect(pkeyIndex).toBeUndefined();
      });
    });

    describe("introspectTable", () => {
      test("should return complete table information for users", async () => {
        const tableInfo = await adapter.introspectTable("users");

        expect(tableInfo.name).toBe("users");
        expect(tableInfo.columns.length).toBeGreaterThan(0);
        expect(tableInfo.primaryKeys.length).toBe(1);
        expect(tableInfo.foreignKeys).toHaveLength(0);
        expect(tableInfo.uniqueConstraints.length).toBeGreaterThan(0);
      });

      test("should return complete table information for posts with foreign keys", async () => {
        const tableInfo = await adapter.introspectTable("posts");

        expect(tableInfo.name).toBe("posts");
        expect(tableInfo.columns.length).toBeGreaterThan(0);
        expect(tableInfo.primaryKeys.length).toBe(1);
        expect(tableInfo.foreignKeys.length).toBe(1);
      });

      test("should return complete table information for post_tags with composite PK", async () => {
        const tableInfo = await adapter.introspectTable("post_tags");

        expect(tableInfo.name).toBe("post_tags");
        expect(tableInfo.primaryKeys.length).toBe(2);
        expect(tableInfo.foreignKeys.length).toBe(1);
      });
    });

    describe("introspectDatabase", () => {
      test("should return all tables in the database", async () => {
        const schema = await adapter.introspectDatabase("public");

        expect(schema.tables.length).toBeGreaterThan(0);

        const tableNames = schema.tables.map((t) => t.name);
        expect(tableNames).toContain("users");
        expect(tableNames).toContain("posts");
        expect(tableNames).toContain("comments");
        expect(tableNames).toContain("post_tags");
        expect(tableNames).not.toContain("_migrations");
      });

      test("should return complete information for all tables", async () => {
        const schema = await adapter.introspectDatabase("public");

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
        const schema = await adapter.introspectDatabase();

        expect(schema.tables.length).toBeGreaterThan(0);
      });
    });
  });

  describe("generate DDL", () => {
    describe("columnToSQL", () => {
      test("should generate SQL for simple column", () => {
        const column: ColumnInfo = {
          name: "id",
          type: "integer",
          isNullable: false,
          defaultValue: null,
          characterMaximumLength: null,
          numericPrecision: null,
          numericScale: null,
          udtName: "int4",
        };

        const sql = adapter.columnToSQL(column);
        expect(sql).toBe("id INTEGER NOT NULL");
      });

      test("should handle nullable column", () => {
        const column: ColumnInfo = {
          name: "description",
          type: "text",
          isNullable: true,
          defaultValue: null,
          characterMaximumLength: null,
          numericPrecision: null,
          numericScale: null,
          udtName: "text",
        };

        const sql = adapter.columnToSQL(column);
        expect(sql).toBe("description TEXT");
      });

      test("should handle varchar with length", () => {
        const column: ColumnInfo = {
          name: "email",
          type: "character varying",
          isNullable: false,
          defaultValue: null,
          characterMaximumLength: 255,
          numericPrecision: null,
          numericScale: null,
          udtName: "varchar",
        };

        const sql = adapter.columnToSQL(column);
        expect(sql).toBe("email VARCHAR(255) NOT NULL");
      });

      test("should handle default value", () => {
        const column: ColumnInfo = {
          name: "is_active",
          type: "boolean",
          isNullable: false,
          defaultValue: "true",
          characterMaximumLength: null,
          numericPrecision: null,
          numericScale: null,
          udtName: "bool",
        };

        const sql = adapter.columnToSQL(column);
        expect(sql).toBe("is_active BOOLEAN NOT NULL DEFAULT true");
      });

      test("should handle SERIAL type", () => {
        const column: ColumnInfo = {
          name: "id",
          type: "integer",
          isNullable: false,
          defaultValue: "nextval('users_id_seq'::regclass)",
          characterMaximumLength: null,
          numericPrecision: null,
          numericScale: null,
          udtName: "int4",
        };

        const sql = adapter.columnToSQL(column);
        expect(sql).toContain("id SERIAL");
      });

      test("should handle timestamp with time zone", () => {
        const column: ColumnInfo = {
          name: "created_at",
          type: "timestamp with time zone",
          isNullable: true,
          defaultValue: null,
          characterMaximumLength: null,
          numericPrecision: null,
          numericScale: null,
          udtName: "timestamptz",
        };

        const sql = adapter.columnToSQL(column);
        expect(sql).toBe("created_at TIMESTAMPTZ");
      });
    });

    describe("generateCreateTable", () => {
      test("should generate simple CREATE TABLE statement", () => {
        const table: TableInfo = {
          name: "users",
          columns: [
            {
              name: "id",
              type: "integer",
              isNullable: false,
              defaultValue: "nextval('users_id_seq'::regclass)",
              characterMaximumLength: null,
              numericPrecision: null,
              numericScale: null,
              udtName: "int4",
            },
            {
              name: "email",
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
          uniqueConstraints: [{ constraintName: "users_email_key", columnNames: ["email"] }],
          indexes: [],
        };

        const sql = adapter.generateCreateTable(table);
        expect(sql).toContain("CREATE TABLE users");
        expect(sql).toContain("id SERIAL");
        expect(sql).toContain("email VARCHAR(255) NOT NULL");
        expect(sql).toContain("PRIMARY KEY (id)");
        expect(sql).toContain("UNIQUE (email)");
      });

      test("should handle composite primary key", () => {
        const table: TableInfo = {
          name: "post_tags",
          columns: [
            {
              name: "post_id",
              type: "integer",
              isNullable: false,
              defaultValue: null,
              characterMaximumLength: null,
              numericPrecision: null,
              numericScale: null,
              udtName: "int4",
            },
            {
              name: "tag_name",
              type: "character varying",
              isNullable: false,
              defaultValue: null,
              characterMaximumLength: 50,
              numericPrecision: null,
              numericScale: null,
              udtName: "varchar",
            },
          ],
          primaryKeys: [
            { columnName: "post_id", position: 1 },
            { columnName: "tag_name", position: 2 },
          ],
          foreignKeys: [],
          uniqueConstraints: [],
          indexes: [],
        };

        const sql = adapter.generateCreateTable(table);
        expect(sql).toContain("PRIMARY KEY (post_id, tag_name)");
      });

      test("should handle foreign keys", () => {
        const table: TableInfo = {
          name: "posts",
          columns: [
            {
              name: "id",
              type: "integer",
              isNullable: false,
              defaultValue: "nextval('posts_id_seq'::regclass)",
              characterMaximumLength: null,
              numericPrecision: null,
              numericScale: null,
              udtName: "int4",
            },
            {
              name: "author_id",
              type: "integer",
              isNullable: false,
              defaultValue: null,
              characterMaximumLength: null,
              numericPrecision: null,
              numericScale: null,
              udtName: "int4",
            },
          ],
          primaryKeys: [{ columnName: "id", position: 1 }],
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
        };

        const sql = adapter.generateCreateTable(table);
        expect(sql).toContain("FOREIGN KEY (author_id) REFERENCES users(id)");
        expect(sql).toContain("ON DELETE CASCADE");
      });
    });

    describe("generateDropTable", () => {
      test("should generate DROP TABLE statement", () => {
        const sql = adapter.generateDropTable("users");
        expect(sql).toBe("DROP TABLE IF EXISTS users CASCADE;");
      });
    });

    describe("sortTablesByDependencies", () => {
      test("should sort tables with no dependencies", () => {
        const tables: TableInfo[] = [
          { name: "users", columns: [], primaryKeys: [], foreignKeys: [], uniqueConstraints: [], indexes: [] },
          { name: "products", columns: [], primaryKeys: [], foreignKeys: [], uniqueConstraints: [], indexes: [] },
        ];

        const sorted = adapter.sortTablesByDependencies(tables);
        expect(sorted).toHaveLength(2);
      });

      test("should sort tables with foreign key dependencies", () => {
        const tables: TableInfo[] = [
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

      test("should handle multiple levels of dependencies", () => {
        const tables: TableInfo[] = [
          {
            name: "comments",
            columns: [],
            primaryKeys: [],
            foreignKeys: [
              {
                columnName: "post_id",
                foreignTableName: "posts",
                foreignColumnName: "id",
                updateRule: "NO ACTION",
                deleteRule: "CASCADE",
                constraintName: "comments_post_id_fkey",
              },
            ],
            uniqueConstraints: [],
            indexes: [],
          },
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
        expect(sorted[2].name).toBe("comments");
      });
    });

    describe("generateUpMigration", () => {
      test("should generate complete up migration", () => {
        const schema: IntrospectedSchema = {
          tables: [
            {
              name: "users",
              columns: [
                {
                  name: "id",
                  type: "integer",
                  isNullable: false,
                  defaultValue: "nextval('users_id_seq'::regclass)",
                  characterMaximumLength: null,
                  numericPrecision: null,
                  numericScale: null,
                  udtName: "int4",
                },
              ],
              primaryKeys: [{ columnName: "id", position: 1 }],
              foreignKeys: [],
              uniqueConstraints: [],
              indexes: [],
            },
          ],
        };

        const sql = adapter.generateUpMigration(schema);
        expect(sql).toContain("CREATE TABLE users");
        expect(sql).toContain("PRIMARY KEY (id)");
      });

      test("should generate migrations in dependency order", () => {
        const schema: IntrospectedSchema = {
          tables: [
            {
              name: "posts",
              columns: [
                {
                  name: "id",
                  type: "integer",
                  isNullable: false,
                  defaultValue: "nextval('posts_id_seq'::regclass)",
                  characterMaximumLength: null,
                  numericPrecision: null,
                  numericScale: null,
                  udtName: "int4",
                },
                {
                  name: "author_id",
                  type: "integer",
                  isNullable: false,
                  defaultValue: null,
                  characterMaximumLength: null,
                  numericPrecision: null,
                  numericScale: null,
                  udtName: "int4",
                },
              ],
              primaryKeys: [{ columnName: "id", position: 1 }],
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
              columns: [
                {
                  name: "id",
                  type: "integer",
                  isNullable: false,
                  defaultValue: "nextval('users_id_seq'::regclass)",
                  characterMaximumLength: null,
                  numericPrecision: null,
                  numericScale: null,
                  udtName: "int4",
                },
              ],
              primaryKeys: [{ columnName: "id", position: 1 }],
              foreignKeys: [],
              uniqueConstraints: [],
              indexes: [],
            },
          ],
        };

        const sql = adapter.generateUpMigration(schema);
        const usersIndex = sql.indexOf("CREATE TABLE users");
        const postsIndex = sql.indexOf("CREATE TABLE posts");
        expect(usersIndex).toBeLessThan(postsIndex);
      });

      test("should include index creation statements", () => {
        const schema: IntrospectedSchema = {
          tables: [
            {
              name: "comments",
              columns: [
                {
                  name: "id",
                  type: "integer",
                  isNullable: false,
                  defaultValue: "nextval('comments_id_seq'::regclass)",
                  characterMaximumLength: null,
                  numericPrecision: null,
                  numericScale: null,
                  udtName: "int4",
                },
              ],
              primaryKeys: [{ columnName: "id", position: 1 }],
              foreignKeys: [],
              uniqueConstraints: [],
              indexes: [
                {
                  indexName: "idx_comments_post",
                  indexDefinition: "CREATE INDEX idx_comments_post ON public.comments USING btree (post_id)",
                },
              ],
            },
          ],
        };

        const sql = adapter.generateUpMigration(schema);
        expect(sql).toContain("CREATE INDEX idx_comments_post");
      });
    });

    describe("generateDownMigration", () => {
      test("should generate DROP statements in reverse dependency order", () => {
        const schema: IntrospectedSchema = {
          tables: [
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
          ],
        };

        const sql = adapter.generateDownMigration(schema);
        const postsIndex = sql.indexOf("DROP TABLE IF EXISTS posts");
        const usersIndex = sql.indexOf("DROP TABLE IF EXISTS users");
        expect(postsIndex).toBeLessThan(usersIndex);
      });
    });
  });
});
