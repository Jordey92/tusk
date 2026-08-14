import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import {
  isUnitTestFile,
  unitTestArgs,
  unitTestIgnorePatterns,
  unitTestRoots,
} from "./unit-test-plan.ts";

const listTestFiles = async (): Promise<string[]> => {
  const files: string[] = [];
  for await (const file of new Glob("**/*.test.ts").scan({
    cwd: process.cwd(),
    onlyFiles: true,
  })) {
    const normalized = file.replaceAll("\\", "/");
    if (normalized.startsWith("node_modules/") || normalized.startsWith("dist/")) {
      continue;
    }
    files.push(normalized);
  }
  return files.sort();
};

const quotedScriptFiles = (script: string): string[] =>
  [...script.matchAll(/[^\s"]+\.test\.ts/g)].map((match) => match[0]).sort();

describe("unit test discovery", () => {
  test("uses directory roots and ignore patterns instead of a file list", () => {
    const args = unitTestArgs();

    expect(args.slice(0, 1 + unitTestRoots.length)).toEqual([
      "test",
      ...unitTestRoots,
    ]);
    expect(args.filter((arg) => arg.endsWith(".test.ts"))).toEqual([
      ...unitTestIgnorePatterns,
    ]);
    expect(isUnitTestFile("cli/commands/future.test.ts")).toBe(true);
    expect(isUnitTestFile("plugins/elysia.test.ts")).toBe(false);
    expect(isUnitTestFile("cli.test.ts")).toBe(false);
  });

  test("classifies every repository test file as unit, smoke, or db", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const smoke = quotedScriptFiles(packageJson.scripts["test:smoke"] ?? "");
    const db = quotedScriptFiles(packageJson.scripts["test:db"] ?? "");
    const all = await listTestFiles();
    const unit = all.filter(isUnitTestFile);
    const classified = new Set([...unit, ...smoke, ...db]);

    expect(packageJson.scripts["test:unit"]).toBe(
      "bun scripts/run-unit-tests.ts"
    );
    expect([...classified].sort()).toEqual(all);
    expect(unit.length).toBeGreaterThan(0);
    expect(unit).not.toContain("plugins/elysia.test.ts");
    expect(unit).toContain("plugins/elysia-config.test.ts");
  });
});
