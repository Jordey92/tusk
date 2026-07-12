import { describe, test, expect, beforeAll } from "bun:test";
import { isTuskError } from "../utils/errors";
import {
  readMigrations,
  getFilesFromDirectory,
  getSqlFilesFromList,
  extractTimestampFromFilename,
  readSqlFile,
  sortMigrationsByTimestamp,
} from "./read-migrations";
import type { Migration } from "../types/migrations";

const MIGRATION_TEST_FILE_NAME = "1759531351_test_file_1.up.sql";

describe("getFilesFromDirectory", () => {
  test("should return all files from directory", async () => {
    const files = await getFilesFromDirectory("./fixtures/migrations");
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(MIGRATION_TEST_FILE_NAME);
  });

  test("should throw error for non-existent directory", async () => {
    await expect(
      getFilesFromDirectory("./non-existent-directory")
    ).rejects.toThrow("Migrations directory not found");
  });

  test("should throw TuskError for non-existent directory", async () => {
    try {
      await getFilesFromDirectory("./non-existent-directory");
    } catch (error) {
      expect(isTuskError(error)).toBe(true);
      return;
    }

    throw new Error("Expected getFilesFromDirectory to throw");
  });

  test("should handle relative paths", async () => {
    const files = await getFilesFromDirectory("fixtures/migrations");
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(MIGRATION_TEST_FILE_NAME);
  });

  test("should handle empty directory", async () => {
    const { mkdtemp, rmdir } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-"));

    try {
      const files = await getFilesFromDirectory(tempDir);
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBe(0);
    } finally {
      await rmdir(tempDir);
    }
  });
});

describe("getSqlFilesFromList", () => {
  test("should return .sql files for up migrations", () => {
    const sqlFiles = getSqlFilesFromList(
      ["file.up.sql", "file.down.sql", "file.txt", "file.js"],
      "up"
    );
    expect(sqlFiles.length).toBe(1);
    expect(sqlFiles).toContain("file.up.sql");
  });

  test("should return .sql files for down migrations", () => {
    const sqlFiles = getSqlFilesFromList(
      ["file.up.sql", "file.down.sql", "file.txt", "file.js"],
      "down"
    );
    expect(sqlFiles.length).toBe(1);
    expect(sqlFiles).toContain("file.down.sql");
  });

  test("should default to up direction when no direction specified", () => {
    const sqlFiles = getSqlFilesFromList([
      "001_create_users.up.sql",
      "001_create_users.down.sql",
      "002_add_posts.up.sql"
    ]);
    expect(sqlFiles.length).toBe(2);
    expect(sqlFiles).toContain("001_create_users.up.sql");
    expect(sqlFiles).toContain("002_add_posts.up.sql");
    expect(sqlFiles).not.toContain("001_create_users.down.sql");
  });

  test("should handle empty file list", () => {
    const sqlFiles = getSqlFilesFromList([], "up");
    expect(Array.isArray(sqlFiles)).toBe(true);
    expect(sqlFiles.length).toBe(0);
  });

  test("should handle files with similar extensions", () => {
    const sqlFiles = getSqlFilesFromList([
      "migration.sql",
      "migration.up.sql",
      "migration.down.sql",
      "migration.rollback.sql"
    ], "up");
    expect(sqlFiles.length).toBe(1);
    expect(sqlFiles).toContain("migration.up.sql");
    expect(sqlFiles).not.toContain("migration.sql");
    expect(sqlFiles).not.toContain("migration.rollback.sql");
  });

  test("should handle mixed case but be case sensitive", () => {
    const sqlFiles = getSqlFilesFromList([
      "migration.UP.sql",
      "migration.up.sql",
      "migration.Up.sql"
    ], "up");
    expect(sqlFiles.length).toBe(1);
    expect(sqlFiles).toContain("migration.up.sql");
  });
});

describe("extractTimestampFromFilename", () => {
  test("should throw error for invalid filename format", () => {
    expect(() =>
      extractTimestampFromFilename("1759531351_test_file_1.sql")
    ).toThrow("Filename must start with a numeric timestamp");
  });

  test("should return timestamp from .up.sql filename", () => {
    const timestamp = extractTimestampFromFilename(
      "1759531351_test_file_1.up.sql"
    );
    expect(timestamp).toBe("1759531351");
  });

  test("should return timestamp from .down.sql filename", () => {
    const timestamp = extractTimestampFromFilename(
      "1759531351_test_file_1.down.sql"
    );
    expect(timestamp).toBe("1759531351");
  });

  test("should handle filename with no underscore", () => {
    const timestamp = extractTimestampFromFilename("1759531351.up.sql");
    expect(timestamp).toBe("1759531351");
  });

  test("rejects an underscore without a migration name", () => {
    expect(() => extractTimestampFromFilename("1759531351_.up.sql")).toThrow(
      "Filename must start with a numeric timestamp"
    );
  });

  test("should handle very long timestamps", () => {
    const longTimestamp = "17595313511234567890";
    const timestamp = extractTimestampFromFilename(
      `${longTimestamp}_migration.up.sql`
    );
    expect(timestamp).toBe(longTimestamp);
  });

  test("should handle timestamps with leading zeros", () => {
    const timestamp = extractTimestampFromFilename("0001234567_test.up.sql");
    expect(timestamp).toBe("0001234567");
  });

  test("rejects non-numeric timestamps", () => {
    expect(() => extractTimestampFromFilename("abc123_test.up.sql")).toThrow(
      "Filename must start with a numeric timestamp"
    );
  });

  test("should throw error for empty filename", () => {
    expect(() => extractTimestampFromFilename("")).toThrow(
      "Filename must start with a numeric timestamp"
    );
  });
});

describe("readSqlFile", () => {
  test("should read SQL content from file", async () => {
    const sql = await readSqlFile(
      "./fixtures/migrations",
      MIGRATION_TEST_FILE_NAME
    );
    expect(sql).toBeTruthy();
    expect(typeof sql).toBe("string");
    expect(sql.length).toBeGreaterThan(0);
  });

  test("should throw error for non-existent file", async () => {
    await expect(
      readSqlFile("./fixtures/migrations", "non_existent_file.up.sql")
    ).rejects.toThrow();
  });

  test("should handle empty SQL files", async () => {
    const { writeFile, unlink, mkdtemp } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-"));
    const emptyFile = "empty.up.sql";
    const tempFilePath = join(tempDir, emptyFile);

    try {
      await writeFile(tempFilePath, "");
      const sql = await readSqlFile(tempDir, emptyFile);
      expect(sql).toBe("");
      expect(typeof sql).toBe("string");
    } finally {
      await unlink(tempFilePath);
    }
  });

  test("should handle files with special content", async () => {
    const { writeFile, unlink, mkdtemp, rmdir } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-"));
    const specialFile = "special.up.sql";
    const tempFilePath = join(tempDir, specialFile);
    const specialContent = "-- Comment with émojis 🚀\nSELECT '特殊字符' as test;\n";

    try {
      await writeFile(tempFilePath, specialContent, "utf-8");
      const sql = await readSqlFile(tempDir, specialFile);
      expect(sql).toBe(specialContent);
    } finally {
      await unlink(tempFilePath);
      await rmdir(tempDir);
    }
  });

  test("should handle relative and absolute paths", async () => {
    const sql1 = await readSqlFile("./fixtures/migrations", MIGRATION_TEST_FILE_NAME);
    const sql2 = await readSqlFile("fixtures/migrations", MIGRATION_TEST_FILE_NAME);

    expect(sql1).toBe(sql2);
    expect(sql1.length).toBeGreaterThan(0);
  });
});

describe("sortMigrationsByTimestamp", () => {
  test("should sort migrations by timestamp", () => {
    const migrations = [
      "1759531400_test_file_2.up.sql",
      "1759531300_test_file_1.up.sql",
      "1759531600_test_file_4.up.sql",
      "1759531500_test_file_3.up.sql",
    ];

    const sortedMigrations = sortMigrationsByTimestamp(migrations);

    expect(sortedMigrations[0]).toBe("1759531300_test_file_1.up.sql");
    expect(sortedMigrations[1]).toBe("1759531400_test_file_2.up.sql");
    expect(sortedMigrations[2]).toBe("1759531500_test_file_3.up.sql");
    expect(sortedMigrations[3]).toBe("1759531600_test_file_4.up.sql");
  });

  test("should handle empty array", () => {
    const sortedMigrations = sortMigrationsByTimestamp([]);
    expect(Array.isArray(sortedMigrations)).toBe(true);
    expect(sortedMigrations.length).toBe(0);
  });

  test("should handle single migration", () => {
    const migrations = ["1759531300_single.up.sql"];
    const sortedMigrations = sortMigrationsByTimestamp(migrations);
    expect(sortedMigrations).toEqual(["1759531300_single.up.sql"]);
  });

  test("should handle timestamps of different lengths", () => {
    const migrations = [
      "1759531400_long_timestamp.up.sql",
      "123_short_timestamp.up.sql",
      "17595314001234567890_very_long_timestamp.up.sql",
    ];

    const sortedMigrations = sortMigrationsByTimestamp(migrations);

    expect(sortedMigrations[0]).toBe("123_short_timestamp.up.sql");
    expect(sortedMigrations[1]).toBe("1759531400_long_timestamp.up.sql");
    expect(sortedMigrations[2]).toBe("17595314001234567890_very_long_timestamp.up.sql");
  });

  test("should sort numerically not lexicographically", () => {
    const migrations = [
      "2_second.up.sql",
      "10_tenth.up.sql",
      "1_first.up.sql",
    ];

    const sortedMigrations = sortMigrationsByTimestamp(migrations);

    expect(sortedMigrations[0]).toBe("1_first.up.sql");
    expect(sortedMigrations[1]).toBe("2_second.up.sql");
    expect(sortedMigrations[2]).toBe("10_tenth.up.sql");
  });

  test("should handle duplicate timestamps", () => {
    const migrations = [
      "1759531400_second.up.sql",
      "1759531400_first.up.sql",
    ];

    const sortedMigrations = sortMigrationsByTimestamp(migrations);

    // Both should be present, order between duplicates may vary
    expect(sortedMigrations).toContain("1759531400_second.up.sql");
    expect(sortedMigrations).toContain("1759531400_first.up.sql");
    expect(sortedMigrations.length).toBe(2);
  });

  test("should throw error for invalid filenames", () => {
    const migrations = ["1_valid.up.sql", "invalid_filename.sql"];

    expect(() => sortMigrationsByTimestamp(migrations)).toThrow(
      "Filename must start with a numeric timestamp"
    );
  });
});

describe("readMigrations", () => {
  let upMigrations: Migration[];
  let downMigrations: Migration[];

  beforeAll(async () => {
    upMigrations = await readMigrations("./fixtures/migrations", "up");
    downMigrations = await readMigrations("./fixtures/migrations", "down");
  });

  test("should read and return migration objects for up direction", () => {
    expect(upMigrations.length).toBeGreaterThan(0);
    expect(upMigrations[0]).toHaveProperty("filename");
    expect(upMigrations[0]).toHaveProperty("timestamp");
    expect(upMigrations[0]).toHaveProperty("sql");
  });

  test("should have correct types", () => {
    expect(typeof upMigrations[0].filename).toBe("string");
    expect(typeof upMigrations[0].timestamp).toBe("string");
    expect(typeof upMigrations[0].sql).toBe("string");
  });

  test("should sort migrations by timestamp", () => {
    for (let i = 0; i < upMigrations.length - 1; i++) {
      expect(Number(upMigrations[i].timestamp)).toBeLessThanOrEqual(
        Number(upMigrations[i + 1].timestamp)
      );
    }
  });

  test("should only return up migrations when direction is up", () => {
    upMigrations.forEach((m) => {
      expect(m.filename).toContain(".up.sql");
    });
  });

  test("should only return down migrations when direction is down", () => {
    downMigrations.forEach((m) => {
      expect(m.filename).toContain(".down.sql");
    });
  });

  test("should throw error for non-existent directory", async () => {
    await expect(
      readMigrations("./non-existent-directory", "up")
    ).rejects.toThrow("Migrations directory not found");
  });

  test("should return empty array for directory with no SQL files", async () => {
    // Create a temporary directory with no SQL files
    const { mkdtemp, rmdir, writeFile, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-"));
    const textFile = join(tempDir, "readme.txt");

    try {
      await writeFile(textFile, "No SQL files here");
      const migrations = await readMigrations(tempDir, "up");
      expect(Array.isArray(migrations)).toBe(true);
      expect(migrations.length).toBe(0);
    } finally {
      await unlink(textFile);
      await rmdir(tempDir);
    }
  });

  test("should use default direction when not specified", async () => {
    const migrations = await readMigrations("./fixtures/migrations");
    // Should default to 'up' direction
    migrations.forEach((m) => {
      expect(m.filename).toContain(".up.sql");
    });
  });

  test("should handle mixed valid and invalid filenames", async () => {
    // Create a temporary directory with mixed files
    const { mkdtemp, rmdir, writeFile, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-"));
    const validFile = join(tempDir, "1234567890_valid.up.sql");
    const invalidFile = join(tempDir, "invalid.sql");
    const textFile = join(tempDir, "readme.txt");

    try {
      await writeFile(validFile, "CREATE TABLE test();");
      await writeFile(invalidFile, "SELECT 1;");
      await writeFile(textFile, "Not a migration");

      const migrations = await readMigrations(tempDir, "up");

      expect(migrations.length).toBe(1);
      expect(migrations[0].filename).toBe("1234567890_valid.up.sql");
      expect(migrations[0].timestamp).toBe("1234567890");
      expect(migrations[0].sql).toBe("CREATE TABLE test();");
    } finally {
      await unlink(validFile);
      await unlink(invalidFile);
      await unlink(textFile);
      await rmdir(tempDir);
    }
  });

  test("should handle files that can't be read (simulated)", async () => {
    // Test with a directory path instead of file path for readSqlFile to trigger error
    await expect(
      readSqlFile("./fixtures", "migrations")
    ).rejects.toThrow();
  });
});
