import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { initializeProject } from "./init-project";

describe("project init", () => {
  test("creates the migrations directory without touching a database", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-init-project-"));

    try {
      const result = await initializeProject(join(workspace, "migrations"));

      expect(result.created).toBe(true);
      expect(result.migrationsPath).toBe(join(workspace, "migrations"));
      expect(existsSync(result.absolutePath)).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("is idempotent when migrations already exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-init-project-"));
    const migrationsPath = join(workspace, "migrations");

    try {
      const firstRun = await initializeProject(migrationsPath);
      const secondRun = await initializeProject(migrationsPath);

      expect(firstRun.created).toBe(true);
      expect(secondRun.created).toBe(false);
      expect(secondRun.absolutePath).toBe(firstRun.absolutePath);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
