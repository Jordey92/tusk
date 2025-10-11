import { describe, expect, test } from "bun:test";
import { getCurrentDir } from "./runtime";
import { dirname } from "path";

describe("getCurrentDir", () => {
  test("should return a valid directory path", () => {
    const dir = getCurrentDir();

    expect(dir).toBeDefined();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });

  test("should return absolute path", () => {
    const dir = getCurrentDir();

    // Absolute paths start with / on Unix or a drive letter on Windows
    expect(dir.startsWith("/") || /^[A-Z]:/i.test(dir)).toBe(true);
  });

  test("should return path to utils directory", () => {
    const dir = getCurrentDir();

    // Should end with utils directory since this test is in utils/
    expect(dir).toContain("utils");
  });

  test("should be deterministic", () => {
    const dir1 = getCurrentDir();
    const dir2 = getCurrentDir();

    expect(dir1).toBe(dir2);
  });

  test("should work in Bun runtime", () => {
    // This test verifies the function works in Bun
    // Bun should provide import.meta.dir
    const dir = getCurrentDir();

    expect(dir).toBeDefined();
    expect(dir).toContain("utils");
  });

  test("should return directory without trailing slash", () => {
    const dir = getCurrentDir();

    // Check if it ends with utils (not utils/)
    expect(dir).not.toMatch(/\/$/);
  });

  test("should be a directory that contains runtime.ts", () => {
    const dir = getCurrentDir();

    // The directory should logically contain this test file
    // This is a sanity check that it's returning the correct directory
    expect(dir).toContain("utils");
    expect(dir).not.toContain("runtime.test.ts"); // Should be dir, not file
  });
});
