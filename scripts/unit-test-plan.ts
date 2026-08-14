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

export const unitTestArgs = (extra: string[] = []): string[] => [
  "test",
  ...unitTestRoots,
  ...unitTestIgnorePatterns.flatMap((pattern) => [
    "--path-ignore-patterns",
    pattern,
  ]),
  ...extra,
];

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
