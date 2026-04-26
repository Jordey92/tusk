import { describe, expect, test } from "bun:test";
import type { Migration } from "../types/migrations";
import { calculateChecksum } from "../utils/checksum";
import { assertExecutedMigrationChecksums } from "./checksum-validation";
import type { MigrationRecord } from "./track-migrations";

const migration: Migration = {
  filename: "1728123456789_create_widgets.up.sql",
  timestamp: "1728123456789",
  sql: "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
};

const record = (checksum: string | null): MigrationRecord => ({
  filename: migration.filename,
  checksum,
  executed_at: new Date("2026-01-01T00:00:00.000Z"),
});

describe("assertExecutedMigrationChecksums", () => {
  test("accepts matching executed migration checksums", () => {
    expect(() =>
      assertExecutedMigrationChecksums(
        [migration],
        [record(calculateChecksum(migration.sql))]
      )
    ).not.toThrow();
  });

  test("rejects checksum drift for executed migration files", () => {
    expect(() =>
      assertExecutedMigrationChecksums([migration], [record("not-current")])
    ).toThrow("has been modified after execution");
  });

  test("ignores legacy records and missing local files", () => {
    expect(() =>
      assertExecutedMigrationChecksums(
        [migration],
        [
          record(null),
          {
            filename: "1728123456790_missing.up.sql",
            checksum: "not-current",
            executed_at: new Date("2026-01-01T00:00:00.000Z"),
          },
        ]
      )
    ).not.toThrow();
  });
});
