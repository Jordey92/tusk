import { readdirSync } from "node:fs";
import { join } from "node:path";

export const unitTestRoots = [
  "core",
  "utils",
  "adapters",
  "cli",
  "mcp",
  "plugins",
  "scripts",
] as const;

export const unitTestIgnorePatterns = [
  "adapters/pg.test.ts",
  "adapters/postgresjs.test.ts",
  "cli.test.ts",
  "core/init-migration.test.ts",
  "core/run-migrations.test.ts",
  "core/track-migrations.test.ts",
  "mcp/server-db.test.ts",
  "plugins/elysia.test.ts",
] as const;

const ignoreSet = new Set<string>(unitTestIgnorePatterns);

export const isUnitTestFile = (relativePath: string): boolean => {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized.endsWith(".test.ts")) {
    return false;
  }

  if (ignoreSet.has(normalized)) {
    return false;
  }

  return unitTestRoots.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`)
  );
};

const collectTestFiles = (directory: string, prefix: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(join(directory, entry.name), relative));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(relative.replaceAll("\\", "/"));
    }
  }
  return files;
};

export const listUnitTestFiles = (): string[] =>
  unitTestRoots
    .flatMap((root) => collectTestFiles(root, root))
    .filter(isUnitTestFile)
    .sort();

export const unitTestArgs = (extra: string[] = []): string[] => [
  "test",
  ...listUnitTestFiles(),
  ...extra,
];
