import { describe, expect, test } from "bun:test";
import type { ColumnInfo, TableInfo, IntrospectedSchema } from "../types/schema";
import { createPostgresAdapter } from "../adapters/postgres";
import { createTestPool } from "../utils/test-helper";

const pool = createTestPool();
const adapter = createPostgresAdapter(pool);

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
