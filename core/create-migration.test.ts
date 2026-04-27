import { describe, expect, test } from "bun:test";
import { createMigrationFile } from "./create-migration";

describe("createMigrationFile", () => {
  test("should create both up and down migration files", async () => {
    const { mkdtemp, rm, access } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-create-"));
    let result: { upFile: string; downFile: string };

    try {
      result = await createMigrationFile(tempDir, "test_migration");

      expect(result).toHaveProperty("upFile");
      expect(result).toHaveProperty("downFile");
      expect(typeof result.upFile).toBe("string");
      expect(typeof result.downFile).toBe("string");

      await access(join(tempDir, result.upFile));
      await access(join(tempDir, result.downFile));

      expect(result.upFile).toMatch(/^\d+_test_migration\.up\.sql$/);
      expect(result.downFile).toMatch(/^\d+_test_migration\.down\.sql$/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should create files with correct template content", async () => {
    const { mkdtemp, rm, readFile } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-content-"));
    let result: { upFile: string; downFile: string };

    try {
      result = await createMigrationFile(tempDir, "content_test");

      const upContent = await readFile(join(tempDir, result.upFile), "utf-8");
      const downContent = await readFile(join(tempDir, result.downFile), "utf-8");

      expect(upContent).toContain("-- Migration: content_test");
      expect(upContent).toContain("-- Created:");
      expect(upContent).toContain("-- Write your migration SQL here");

      expect(downContent).toContain("-- Rollback: content_test");
      expect(downContent).toContain("-- Created:");
      expect(downContent).toContain("-- Write your rollback SQL here");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should create unique filenames for concurrent calls", async () => {
    const { mkdtemp, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-timestamp-"));
    let results: { upFile: string; downFile: string }[] = [];

    try {
      const promises = [
        createMigrationFile(tempDir, "first"),
        createMigrationFile(tempDir, "second"),
        createMigrationFile(tempDir, "third")
      ];

      results = await Promise.all(promises);

      const upFiles = results.map((result) => result.upFile);
      const downFiles = results.map((result) => result.downFile);

      expect(new Set(upFiles).size).toBe(upFiles.length);
      expect(new Set(downFiles).size).toBe(downFiles.length);

      upFiles.forEach((upFile) => {
        const timestamp = upFile.split("_")[0];
        expect(Number.parseInt(timestamp, 10)).toBeGreaterThan(0);
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should handle filenames with underscores and special characters", async () => {
    const { mkdtemp, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-special-"));
    let result: { upFile: string; downFile: string };

    try {
      const specialName = "add_user_emails-v2@2024";
      result = await createMigrationFile(tempDir, specialName);

      expect(result.upFile).toContain(specialName);
      expect(result.downFile).toContain(specialName);
      expect(result.upFile).toMatch(/^\d+_add_user_emails-v2@2024\.up\.sql$/);
      expect(result.downFile).toMatch(/^\d+_add_user_emails-v2@2024\.down\.sql$/);

    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should handle very long filenames", async () => {
    const { mkdtemp, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-long-"));
    let result: { upFile: string; downFile: string };

    try {
      const longName = "a".repeat(100);
      result = await createMigrationFile(tempDir, longName);

      expect(result.upFile).toContain(longName);
      expect(result.downFile).toContain(longName);

    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should handle relative paths correctly", async () => {
    const { mkdtemp, rm, access } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join, relative } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-relative-"));
    let result: { upFile: string; downFile: string };

    try {
      const relativePath = relative(process.cwd(), tempDir);
      result = await createMigrationFile(relativePath, "relative_test");

      await access(join(tempDir, result.upFile));
      await access(join(tempDir, result.downFile));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should create directory if it does not exist", async () => {
    const { mkdtemp, rm, access } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-create-dir-"));
    const nestedDir = join(tempDir, "nested", "migrations");
    let result: { upFile: string; downFile: string };

    try {
      result = await createMigrationFile(nestedDir, "test");

      await access(join(nestedDir, result.upFile));
      await access(join(nestedDir, result.downFile));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should handle empty filename", async () => {
    const { mkdtemp, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-empty-"));
    let result: { upFile: string; downFile: string };

    try {
      result = await createMigrationFile(tempDir, "");

      expect(result.upFile).toMatch(/^\d+_\.up\.sql$/);
      expect(result.downFile).toMatch(/^\d+_\.down\.sql$/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should create files with different timestamps when called sequentially", async () => {
    const { mkdtemp, rm } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-sequential-"));
    let result1: { upFile: string; downFile: string };
    let result2: { upFile: string; downFile: string };

    try {
      result1 = await createMigrationFile(tempDir, "first");

      await new Promise(resolve => setTimeout(resolve, 1));

      result2 = await createMigrationFile(tempDir, "second");

      const timestamp1 = result1.upFile.split("_")[0];
      const timestamp2 = result2.upFile.split("_")[0];

      expect(timestamp1).not.toBe(timestamp2);
      expect(parseInt(timestamp2)).toBeGreaterThan(parseInt(timestamp1));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("should work with nested directory paths", async () => {
    const { mkdtemp, rm, mkdir, access } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const tempDir = await mkdtemp(join(tmpdir(), "tusk-test-nested-"));
    const nestedDir = join(tempDir, "nested", "migrations");
    let result: { upFile: string; downFile: string };

    try {
      await mkdir(nestedDir, { recursive: true });

      result = await createMigrationFile(nestedDir, "nested_test");

      await access(join(nestedDir, result.upFile));
      await access(join(nestedDir, result.downFile));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
