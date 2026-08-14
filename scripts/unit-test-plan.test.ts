import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import {
  isUnitTestFile,
  listUnitTestFiles,
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
  test("uses discovered files instead of a package.json file list", () => {
    const args = unitTestArgs();
    const files = args.filter((arg) => arg.endsWith(".test.ts"));

    expect(args[0]).toBe("test");
    expect(args).not.toContain("--path-ignore-patterns");
    expect(files).toEqual(listUnitTestFiles());
    expect(files).toContain("plugins/elysia-config.test.ts");
    expect(files).toContain("scripts/unit-test-plan.test.ts");
    expect(files).not.toContain("plugins/elysia.test.ts");
    expect(files).not.toContain("adapters/pg.test.ts");
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

  test("smoke and db files under unit roots are ignored", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const listed = [
      ...quotedScriptFiles(packageJson.scripts["test:smoke"] ?? ""),
      ...quotedScriptFiles(packageJson.scripts["test:db"] ?? ""),
    ];
    const underRoots = listed.filter((file) =>
      unitTestRoots.some((root) => file === root || file.startsWith(`${root}/`))
    );

    for (const file of underRoots) {
      expect(isUnitTestFile(file), file).toBe(false);
    }
    expect(underRoots.length).toBeGreaterThan(0);
  });

  test("unit runner stays compatible with the pinned bun", async () => {
    const ci = await readFile(".github/workflows/ci.yml", "utf8");
    const pins = [...ci.matchAll(/bun-version:\s*["']?([0-9.]+)/g)].map(
      (match) => match[1]
    );
    expect(pins.length).toBeGreaterThan(0);

    const args = unitTestArgs();
    if (!args.includes("--path-ignore-patterns")) return;

    // Flag shipped in bun 1.3.11. A 1.3.8 pin silently ignores it,
    // so db/smoke files under the scanned roots run in test:unit.
    for (const version of pins) {
      const [major, minor, patch] = version.split(".").map(Number);
      const supported =
        major > 1 ||
        (major === 1 && (minor > 3 || (minor === 3 && patch >= 11)));
      expect(supported, `CI pins bun ${version}`).toBe(true);
    }
  });

  test("discovered files exclude every ignore-list path", () => {
    const files = new Set(listUnitTestFiles());
    for (const ignored of unitTestIgnorePatterns) {
      expect(files.has(ignored), ignored).toBe(false);
    }
  });
});
