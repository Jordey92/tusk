import { describe, expect, test } from "bun:test";
import type { Migration } from "../types/migrations";
import { planRollbackMigrations } from "./rollback-plan";

describe("planRollbackMigrations", () => {
  test("throws when an executed migration is missing its rollback file", () => {
    const downMigrations: Migration[] = [];

    expect(() =>
      planRollbackMigrations(["123_create_users.up.sql"], downMigrations)
    ).toThrow("Missing rollback migration file: 123_create_users.down.sql");
  });

  test("returns rollback migrations in execution order", () => {
    const downMigrations: Migration[] = [
      {
        filename: "123_create_users.down.sql",
        timestamp: "123",
        sql: "DROP TABLE users;",
      },
      {
        filename: "124_create_posts.down.sql",
        timestamp: "124",
        sql: "DROP TABLE posts;",
      },
    ];

    const plan = planRollbackMigrations(
      ["124_create_posts.up.sql", "123_create_users.up.sql"],
      downMigrations
    );

    expect(plan.map((migration) => migration.filename)).toEqual([
      "124_create_posts.down.sql",
      "123_create_users.down.sql",
    ]);
  });
});
