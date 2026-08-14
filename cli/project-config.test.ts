import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  loadProjectFileConfig,
  parseProjectFileConfig,
  resolveMigrationsPathFromConfig,
  resolveProjectSettings,
} from "./project-config";

const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const path of cleanupPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

const withTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "tusk-project-config-"));
  cleanupPaths.push(dir);
  return dir;
};

describe("parseProjectFileConfig", () => {
  test("accepts a full valid config object", () => {
    expect(
      parseProjectFileConfig(
        {
          migrationsPath: "db/migrations",
          driver: "postgres",
          statementTimeoutMs: 60_000,
          schema: "app",
        },
        "tusk.config.json"
      )
    ).toEqual({
      migrationsPath: "db/migrations",
      driver: "postgres",
      statementTimeoutMs: 60_000,
      schema: "app",
    });
  });

  test("rejects unknown keys and invalid values", () => {
    expect(() =>
      parseProjectFileConfig({ databaseUrl: "x" }, "tusk.config.json")
    ).toThrow(/unknown config key "databaseUrl"/);

    expect(() =>
      parseProjectFileConfig({ driver: "mysql" }, "tusk.config.json")
    ).toThrow(/driver must be either/);

    expect(() =>
      parseProjectFileConfig({ statementTimeoutMs: -1 }, "tusk.config.json")
    ).toThrow(/statementTimeoutMs/);

    expect(() =>
      parseProjectFileConfig({ schema: "  " }, "tusk.config.json")
    ).toThrow(/schema must be a non-empty string/);
  });
});

describe("loadProjectFileConfig", () => {
  test("returns empty config when no file exists", async () => {
    const cwd = await withTempDir();
    await expect(loadProjectFileConfig({ cwd })).resolves.toEqual({
      path: null,
      config: {},
    });
  });

  test("loads tusk.config.json from cwd", async () => {
    const cwd = await withTempDir();
    const configPath = join(cwd, "tusk.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        migrationsPath: "migrations",
        driver: "pg",
        statementTimeoutMs: 0,
        schema: "public",
      })
    );

    await expect(loadProjectFileConfig({ cwd })).resolves.toEqual({
      path: resolve(configPath),
      config: {
        migrationsPath: "migrations",
        driver: "pg",
        statementTimeoutMs: 0,
        schema: "public",
      },
    });
  });

  test("prefers json over mjs and ts when multiple exist", async () => {
    const cwd = await withTempDir();
    await writeFile(
      join(cwd, "tusk.config.json"),
      JSON.stringify({ migrationsPath: "from-json" })
    );
    await writeFile(
      join(cwd, "tusk.config.mjs"),
      `export default { migrationsPath: "from-mjs" };\n`
    );
    await writeFile(
      join(cwd, "tusk.config.ts"),
      `export default { migrationsPath: "from-ts" };\n`
    );

    const loaded = await loadProjectFileConfig({ cwd });
    expect(loaded.config.migrationsPath).toBe("from-json");
  });

  test("loads a TypeScript module config under Bun", async () => {
    const cwd = await withTempDir();
    const configPath = join(cwd, "tusk.config.ts");
    await writeFile(
      configPath,
      `export default { migrationsPath: "ts-migrations", driver: "postgres" as const };\n`
    );

    const loaded = await loadProjectFileConfig({ cwd, runtime: "bun" });
    expect(loaded.path).toBe(resolve(configPath));
    expect(loaded.config).toEqual({
      migrationsPath: "ts-migrations",
      driver: "postgres",
    });
  });

  test("rejects TypeScript project config under Node with an actionable error", async () => {
    const cwd = await withTempDir();
    const configPath = join(cwd, "tusk.config.ts");
    await writeFile(
      configPath,
      `export default { migrationsPath: "ts-migrations" };\n`
    );

    await expect(
      loadProjectFileConfig({ cwd, runtime: "node" })
    ).rejects.toThrow(/TypeScript project config is supported when running Tusk under Bun/);
  });

  test("loads CommonJS tusk.config.js via require", async () => {
    const cwd = await withTempDir();
    const configPath = join(cwd, "tusk.config.js");
    await writeFile(
      configPath,
      `module.exports = { migrationsPath: "js-migrations", driver: "postgres" };\n`
    );

    const loaded = await loadProjectFileConfig({ cwd });
    expect(loaded.path).toBe(resolve(configPath));
    expect(loaded.config).toEqual({
      migrationsPath: "js-migrations",
      driver: "postgres",
    });
  });

  test("loads tusk.config.mjs via dynamic import", async () => {
    const cwd = await withTempDir();
    const configPath = join(cwd, "tusk.config.mjs");
    await writeFile(
      configPath,
      `export default { migrationsPath: "mjs-migrations", driver: "pg" };\n`
    );

    const loaded = await loadProjectFileConfig({ cwd });
    expect(loaded.path).toBe(resolve(configPath));
    expect(loaded.config).toEqual({
      migrationsPath: "mjs-migrations",
      driver: "pg",
    });
  });

  test("Node CLI reads tusk.config.json from a CommonJS project", async () => {
    const { spawnSync } = await import("node:child_process");
    const { existsSync } = await import("node:fs");
    const cliJs = resolve("dist/cli.js");
    if (!existsSync(cliJs)) {
      const build = spawnSync("bun", ["run", "build"], {
        encoding: "utf8",
        cwd: resolve("."),
      });
      expect(build.status).toBe(0);
    }

    const cwd = await withTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "cjs-app", private: true })
    );
    await writeFile(
      join(cwd, "tusk.config.json"),
      JSON.stringify({ migrationsPath: "configured-migrations" })
    );

    const env = { ...process.env };
    delete env.MIGRATIONS_PATH;

    const result = spawnSync("node", [cliJs, "init", "--json"], {
      cwd,
      encoding: "utf8",
      env,
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "init",
      created: true,
      migrationsPath: resolve(cwd, "configured-migrations"),
    });
  });

  test("Node CLI rejects TypeScript project config from a CommonJS project", async () => {
    const { spawnSync } = await import("node:child_process");
    const { existsSync } = await import("node:fs");
    const cliJs = resolve("dist/cli.js");
    if (!existsSync(cliJs)) {
      const build = spawnSync("bun", ["run", "build"], {
        encoding: "utf8",
        cwd: resolve("."),
      });
      expect(build.status).toBe(0);
    }

    const cwd = await withTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "cjs-app", private: true })
    );
    await writeFile(
      join(cwd, "tusk.config.ts"),
      `export default { migrationsPath: "ts-migrations", driver: "postgres" as const };\n`
    );

    const env = { ...process.env };
    delete env.MIGRATIONS_PATH;

    const result = spawnSync("node", [cliJs, "init", "--json"], {
      cwd,
      encoding: "utf8",
      env,
    });

    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toMatch(/TypeScript project config is supported when running Tusk under Bun/);
    expect(output).toMatch(/tusk\.config\.json or tusk\.config\.mjs/);
  });

  test("rejects invalid JSON", async () => {
    const cwd = await withTempDir();
    await writeFile(join(cwd, "tusk.config.json"), "{not-json");

    await expect(loadProjectFileConfig({ cwd })).rejects.toThrow(/invalid JSON/);
  });
});

describe("resolveProjectSettings", () => {
  test("uses built-in defaults", () => {
    expect(
      resolveProjectSettings(
        { path: null, config: {} },
        { env: {} }
      )
    ).toEqual({
      migrationsPath: "./migrations",
      schema: "public",
      configPath: null,
    });
  });

  test("applies file values when env is unset", () => {
    expect(
      resolveProjectSettings(
        {
          path: "/app/tusk.config.json",
          config: {
            migrationsPath: "db/migrations",
            driver: "postgres",
            statementTimeoutMs: 120000,
            schema: "billing",
          },
        },
        { env: {} }
      )
    ).toEqual({
      migrationsPath: resolve("/app/db/migrations"),
      schema: "billing",
      configPath: "/app/tusk.config.json",
    });
  });

  test("lets environment variables override file values", () => {
    expect(
      resolveProjectSettings(
        {
          path: "/app/tusk.config.json",
          config: {
            migrationsPath: "from-file",
            driver: "pg",
            statementTimeoutMs: 1,
            schema: "file_schema",
          },
        },
        {
          env: {
            MIGRATIONS_PATH: "from-env",
            TUSK_SCHEMA: "env_schema",
          },
        }
      )
    ).toEqual({
      migrationsPath: "from-env",
      schema: "env_schema",
      configPath: "/app/tusk.config.json",
    });
  });

  test("lets an explicit migrations path override env and file", () => {
    expect(
      resolveProjectSettings(
        {
          path: null,
          config: { migrationsPath: "from-file" },
        },
        {
          migrationsPathOverride: "from-override",
          env: { MIGRATIONS_PATH: "from-env" },
        }
      ).migrationsPath
    ).toBe("from-override");
  });
});

describe("resolveMigrationsPathFromConfig", () => {
  test("resolves relative paths against the config directory", async () => {
    const cwd = await withTempDir();
    const nested = join(cwd, "apps", "api");
    await mkdir(nested, { recursive: true });
    const configPath = join(nested, "tusk.config.json");

    expect(
      resolveMigrationsPathFromConfig("migrations", configPath, cwd)
    ).toBe(resolve(nested, "migrations"));
  });

  test("keeps absolute migrations paths", () => {
    expect(
      resolveMigrationsPathFromConfig("/abs/migrations", "/app/tusk.config.json")
    ).toBe("/abs/migrations");
  });
});
