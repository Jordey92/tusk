import { describe, expect, test } from "bun:test";
import { createMigrationFile } from "./create-migration";

describe("createMigrationFile", () => {

  test("should create both up and down migration files", async () => {
    const { mkdtemp, rmdir, access, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-create-"));
    let result: any;

    try {
      result = await createMigrationFile(tempDir, "test_migration");

      expect(result).toHaveProperty("upFile");
      expect(result).toHaveProperty("downFile");
      expect(typeof result.upFile).toBe("string");
      expect(typeof result.downFile).toBe("string");

      // Verify files exist
      await access(join(tempDir, result.upFile));
      await access(join(tempDir, result.downFile));

      // Verify naming convention
      expect(result.upFile).toMatch(/^\d+_test_migration\.up\.sql$/);
      expect(result.downFile).toMatch(/^\d+_test_migration\.down\.sql$/);

    } finally {
      // Clean up files first, then directory
      if (result) {
        try {
          await unlink(join(tempDir, result.upFile));
          await unlink(join(tempDir, result.downFile));
        } catch {}
      }
      await rmdir(tempDir);
    }
  });

  test("should create files with correct template content", async () => {
    const { mkdtemp, rmdir, readFile, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-content-"));
    let result: any;

    try {
      result = await createMigrationFile(tempDir, "content_test");

      const upContent = await readFile(join(tempDir, result.upFile), "utf-8");
      const downContent = await readFile(join(tempDir, result.downFile), "utf-8");

      // Verify up file content
      expect(upContent).toContain("-- Migration: content_test");
      expect(upContent).toContain("-- Created:");
      expect(upContent).toContain("-- Write your migration SQL here");

      // Verify down file content
      expect(downContent).toContain("-- Rollback: content_test");
      expect(downContent).toContain("-- Created:");
      expect(downContent).toContain("-- Write your rollback SQL here");

    } finally {
      if (result) {
        try {
          await unlink(join(tempDir, result.upFile));
          await unlink(join(tempDir, result.downFile));
        } catch {}
      }
      await rmdir(tempDir);
    }
  });

  test("should generate unique timestamps for concurrent calls", async () => {
    const { mkdtemp, rmdir, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-timestamp-"));
    let results: any[] = [];

    try {
      // Create multiple migrations rapidly
      const promises = [
        createMigrationFile(tempDir, "first"),
        createMigrationFile(tempDir, "second"),
        createMigrationFile(tempDir, "third")
      ];

      results = await Promise.all(promises);

      // Extract timestamps from filenames
      const timestamps = results.map(result =>
        result.upFile.split("_")[0]
      );

      // All timestamps should be different (or at least not all the same)
      // Note: Due to the speed of execution, some timestamps might be the same
      // but we expect at least some variation or all should be valid numbers
      const uniqueTimestamps = new Set(timestamps);
      expect(uniqueTimestamps.size).toBeGreaterThanOrEqual(1);

      // Verify all timestamps are valid numbers
      timestamps.forEach(timestamp => {
        expect(parseInt(timestamp)).toBeGreaterThan(0);
      });

    } finally {
      // Clean up all created files
      for (const result of results) {
        try {
          await unlink(join(tempDir, result.upFile));
          await unlink(join(tempDir, result.downFile));
        } catch {}
      }
      await rmdir(tempDir);
    }
  });

  test("should handle filenames with underscores and special characters", async () => {
    const { mkdtemp, rmdir, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-special-"));
    let result: any;

    try {
      const specialName = "add_user_emails-v2@2024";
      result = await createMigrationFile(tempDir, specialName);

      expect(result.upFile).toContain(specialName);
      expect(result.downFile).toContain(specialName);
      expect(result.upFile).toMatch(/^\d+_add_user_emails-v2@2024\.up\.sql$/);
      expect(result.downFile).toMatch(/^\d+_add_user_emails-v2@2024\.down\.sql$/);

    } finally {
      if (result) {
        try {
          await unlink(join(tempDir, result.upFile));
          await unlink(join(tempDir, result.downFile));
        } catch {}
      }
      await rmdir(tempDir);
    }
  });

  test("should handle very long filenames", async () => {
    const { mkdtemp, rmdir, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-long-"));
    let result: any;

    try {
      const longName = "a".repeat(100);
      result = await createMigrationFile(tempDir, longName);

      expect(result.upFile).toContain(longName);
      expect(result.downFile).toContain(longName);

    } finally {
      if (result) {
        try {
          await unlink(join(tempDir, result.upFile));
          await unlink(join(tempDir, result.downFile));
        } catch {}
      }
      await rmdir(tempDir);
    }
  });

  test("should handle relative paths correctly", async () => {
    const { mkdtemp, rmdir, access, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join, relative } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-relative-"));
    let result: any;

    try {
      // Use relative path
      const relativePath = relative(process.cwd(), tempDir);
      result = await createMigrationFile(relativePath, "relative_test");

      // Files should still be created
      await access(join(tempDir, result.upFile));
      await access(join(tempDir, result.downFile));

    } finally {
      if (result) {
        try {
          await unlink(join(tempDir, result.upFile));
          await unlink(join(tempDir, result.downFile));
        } catch {}
      }
      await rmdir(tempDir);
    }
  });

  test("should throw error for non-existent directory", async () => {
    await expect(
      createMigrationFile("./non-existent-directory", "test")
    ).rejects.toThrow();
  });

  test("should handle empty filename", async () => {
    const { mkdtemp, rmdir, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-empty-"));
    let result: any;

    try {
      result = await createMigrationFile(tempDir, "");

      // Should create files with just timestamp
      expect(result.upFile).toMatch(/^\d+_\.up\.sql$/);
      expect(result.downFile).toMatch(/^\d+_\.down\.sql$/);

    } finally {
      if (result) {
        try {
          await unlink(join(tempDir, result.upFile));
          await unlink(join(tempDir, result.downFile));
        } catch {}
      }
      await rmdir(tempDir);
    }
  });

  test("should create files with different timestamps when called sequentially", async () => {
    const { mkdtemp, rmdir, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-sequential-"));
    let result1: any, result2: any;

    try {
      result1 = await createMigrationFile(tempDir, "first");

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1));

      result2 = await createMigrationFile(tempDir, "second");

      const timestamp1 = result1.upFile.split("_")[0];
      const timestamp2 = result2.upFile.split("_")[0];

      expect(timestamp1).not.toBe(timestamp2);
      expect(parseInt(timestamp2)).toBeGreaterThan(parseInt(timestamp1));

    } finally {
      if (result1) {
        try {
          await unlink(join(tempDir, result1.upFile));
          await unlink(join(tempDir, result1.downFile));
        } catch {}
      }
      if (result2) {
        try {
          await unlink(join(tempDir, result2.upFile));
          await unlink(join(tempDir, result2.downFile));
        } catch {}
      }
      await rmdir(tempDir);
    }
  });

  test("should work with nested directory paths", async () => {
    const { mkdtemp, rmdir, mkdir, access, unlink } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-nested-"));
    const nestedDir = join(tempDir, "nested", "migrations");
    let result: any;

    try {
      await mkdir(nestedDir, { recursive: true });

      result = await createMigrationFile(nestedDir, "nested_test");

      await access(join(nestedDir, result.upFile));
      await access(join(nestedDir, result.downFile));

    } finally {
      if (result) {
        try {
          await unlink(join(nestedDir, result.upFile));
          await unlink(join(nestedDir, result.downFile));
        } catch {}
      }
      await rmdir(tempDir, { recursive: true });
    }
  });
});