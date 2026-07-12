import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Pool } from "pg";
import {
  exerciseExistingDatabaseAdoption,
  exerciseMigrationLifecycle,
  type CliCommandResult,
} from "./utils/cli-smoke";

const repoRoot = process.cwd();
const packageSmokeDatabaseUrl = process.env.TUSK_SMOKE_DATABASE_URL;
const skipPackageBuild = process.env.TUSK_PACKAGE_SMOKE_SKIP_BUILD === "1";
const suppliedPackageTarball = process.env.TUSK_PACKAGE_SMOKE_TARBALL;

interface PackageJson {
  name: string;
  version: string;
  dependencies: Record<string, string>;
}

interface InitSmokePayload {
  ok: boolean;
  command: string;
  created: boolean;
}

interface CreateSmokePayload {
  ok: boolean;
  command: string;
  upFile: string;
}

interface PackageSmokeDatabase {
  connectionString: string;
  pool: Pool;
  cleanup(): Promise<void>;
}

interface ConsumerProject {
  directory: string;
  bin(name: "tusk" | "tusk-mcp" | "tsc"): string;
}

const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, "\"\"")}"`;

const createPackageSmokeDatabase = async (
  connectionString: string
): Promise<PackageSmokeDatabase> => {
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";

  const databaseUrl = new URL(connectionString);
  const databaseName = `tusk_package_smoke_${randomUUID().replace(/-/g, "")}`;
  const quotedDatabaseName = quoteIdentifier(databaseName);
  databaseUrl.pathname = `/${databaseName}`;

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    await adminPool.query(`CREATE DATABASE ${quotedDatabaseName}`);
  } catch (error) {
    await adminPool.end();
    throw error;
  }

  const pool = new Pool({ connectionString: databaseUrl.toString() });

  return {
    connectionString: databaseUrl.toString(),
    pool,
    async cleanup() {
      await pool.end();
      await adminPool.query(
        `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
        `,
        [databaseName]
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
      await adminPool.end();
    },
  };
};

const decode = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

const runCommand = async (
  cmd: string[],
  cwd: string,
  envOverrides: Record<string, string> = {}
): Promise<CliCommandResult> => {
  const child = Bun.spawn(cmd, {
    cwd,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    decode(child.stdout),
    decode(child.stderr),
    child.exited,
  ]);

  return { exitCode, stdout, stderr };
};

const expectSuccess = (result: CliCommandResult) => {
  expect(result.exitCode, result.stderr || result.stdout).toBe(0);
};

const createConsumerProject = async (
  root: string,
  name: string,
  tarball: string,
  dependencies: string[] = []
): Promise<ConsumerProject> => {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: `tusk-consumer-${name}`, private: true, type: "module" })
  );

  const installResult = await runCommand(
    [
      "npm",
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
      "typescript@^5.9.3",
      "@types/node@^24.0.0",
      ...dependencies,
    ],
    directory
  );
  expectSuccess(installResult);

  return {
    directory,
    bin: (binName) => join(
      directory,
      "node_modules",
      ".bin",
      process.platform === "win32" ? `${binName}.cmd` : binName
    ),
  };
};

const typecheck = async (
  project: ConsumerProject,
  source: string,
  skipLibCheck = false
) => {
  await writeFile(join(project.directory, "consumer.ts"), source);
  await writeFile(
    join(project.directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        skipLibCheck,
        noEmit: true,
      },
      include: ["consumer.ts"],
    })
  );

  expectSuccess(await runCommand([project.bin("tsc")], project.directory));
};

const runMcpRequest = async (
  project: ConsumerProject,
  request: Record<string, unknown>,
  envOverrides: Record<string, string> = {}
) => {
  const child = Bun.spawn([project.bin("tusk-mcp")], {
    cwd: project.directory,
    env: {
      ...process.env,
      LOG_LEVEL: "error",
      ...envOverrides,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  child.stdin.write(`${JSON.stringify(request)}\n`);
  child.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    decode(child.stdout),
    decode(child.stderr),
    child.exited,
  ]);

  expect(exitCode, stderr || stdout).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
};

describe("package smoke test", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  test("clean installed consumers can use every supported package entrypoint", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(repoRoot, "package.json"), "utf-8")
    ) as PackageJson;
    const packageName = packageJson.name;
    const tempRoot = await mkdtemp(join(tmpdir(), "tusk-package-smoke-"));
    cleanupPaths.push(tempRoot);

    let tarball: string;
    if (suppliedPackageTarball) {
      tarball = resolve(suppliedPackageTarball);
      expect(await readFile(tarball)).not.toHaveLength(0);
    } else {
      if (!skipPackageBuild) {
        expectSuccess(await runCommand(["bun", "run", "build"], repoRoot));
      }

      const packResult = await runCommand(
        ["npm", "pack", "--pack-destination", tempRoot],
        repoRoot
      );
      expectSuccess(packResult);

      const tarballName = (await readdir(tempRoot)).find((file) =>
        file.endsWith(".tgz")
      );
      expect(tarballName).toBeDefined();
      tarball = join(tempRoot, tarballName!);
    }
    const archiveListing = await runCommand(["tar", "-tzf", tarball], tempRoot);
    expectSuccess(archiveListing);
    expect(archiveListing.stdout).not.toContain(".map");
    expect(archiveListing.stdout).not.toContain("dist/scripts/quality");
    expect(archiveListing.stdout).not.toContain("dist/utils/test-helper");
    expect(archiveListing.stdout).toContain("package/docs/compatibility.md");
    expect(archiveListing.stdout).toContain("package/examples/basic/README.md");
    expect(archiveListing.stdout).not.toContain("dist/utils/cli-smoke");

    const extractedRoot = join(tempRoot, "extracted");
    await mkdir(extractedRoot);
    expectSuccess(await runCommand(
      ["tar", "-xzf", tarball, "-C", extractedRoot],
      tempRoot
    ));
    const extractedExample = join(extractedRoot, "package", "examples", "basic");
    const extractedExamplePackagePath = join(extractedExample, "package.json");
    const extractedExamplePackage = JSON.parse(
      await readFile(extractedExamplePackagePath, "utf8")
    ) as PackageJson;
    expect(extractedExamplePackage.dependencies[packageName]).toBe(
      `^${packageJson.version}`
    );
    extractedExamplePackage.dependencies[packageName] = `file:${tarball}`;
    await writeFile(
      extractedExamplePackagePath,
      `${JSON.stringify(extractedExamplePackage, null, 2)}\n`
    );
    expectSuccess(await runCommand(
      ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"],
      extractedExample
    ));
    expectSuccess(await runCommand(
      ["npm", "run", "db:validate"],
      extractedExample,
      { LOG_LEVEL: "error" }
    ));

    const [rootProject, pgProject, postgresProject, elysiaProject] =
      await Promise.all([
        createConsumerProject(tempRoot, "root", tarball),
        createConsumerProject(tempRoot, "pg", tarball, [
          "pg@^8.16.3",
          "@types/pg@^8.15.5",
        ]),
        createConsumerProject(tempRoot, "postgres", tarball, [
          "postgres@^3.4.7",
        ]),
        createConsumerProject(tempRoot, "elysia", tarball, [
          "elysia@^1.4.27",
          "pg@^8.16.3",
          "@types/pg@^8.15.5",
        ]),
      ]);

    const baseCommandEnv = {
      LOG_LEVEL: "error",
      MIGRATIONS_PATH: "migrations",
    };

    const versionResult = await runCommand(
      [rootProject.bin("tusk"), "version"],
      rootProject.directory,
      baseCommandEnv
    );
    expectSuccess(versionResult);
    expect(versionResult.stdout).toContain("tusk v");

    await mkdir(join(rootProject.directory, "migrations"));
    await writeFile(
      join(rootProject.directory, "migrations", "123_root_consumer.up.sql"),
      "SELECT 1;"
    );
    await writeFile(
      join(rootProject.directory, "root.mjs"),
      `
        import { readMigrations } from ${JSON.stringify(packageName)};
        const migrations = await readMigrations("./migrations");
        console.log(migrations.map(({ filename }) => filename).join(","));
      `
    );
    const rootImport = await runCommand(
      ["node", "root.mjs"],
      rootProject.directory
    );
    expectSuccess(rootImport);
    expect(rootImport.stdout).toContain("123_root_consumer.up.sql");

    const bunRootImport = await runCommand(
      ["bun", "root.mjs"],
      rootProject.directory
    );
    expectSuccess(bunRootImport);
    expect(bunRootImport.stdout).toContain("123_root_consumer.up.sql");

    const bunCli = await runCommand(
      [
        "bun",
        join(
          rootProject.directory,
          "node_modules",
          "@bydey",
          "tusk",
          "dist",
          "cli.js"
        ),
        "version",
      ],
      rootProject.directory,
      baseCommandEnv
    );
    expectSuccess(bunCli);
    expect(bunCli.stdout).toContain("tusk v");

    const driverlessMcp = await runMcpRequest(rootProject, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(driverlessMcp).toMatchObject({
      result: {
        serverInfo: { name: "@bydey/tusk" },
      },
    });

    const runPackagedCli = (args: string[]) =>
      runCommand(
        [pgProject.bin("tusk"), ...args],
        pgProject.directory,
        baseCommandEnv
      );

    let smokeDatabase: PackageSmokeDatabase | undefined;
    if (packageSmokeDatabaseUrl) {
      smokeDatabase = await createPackageSmokeDatabase(packageSmokeDatabaseUrl);
    }

    try {
      if (smokeDatabase) {
        const commandEnv = {
          ...baseCommandEnv,
          DATABASE_URL: smokeDatabase.connectionString,
        };
        const runDatabaseCli = (args: string[]) =>
          runCommand(
            [pgProject.bin("tusk"), ...args],
            pgProject.directory,
            commandEnv
          );
        const smokeName = `smoke_test_${Date.now()}`;

        await exerciseMigrationLifecycle({
          runCli: runDatabaseCli,
          migrationsPath: join(pgProject.directory, "migrations"),
          pool: smokeDatabase.pool,
          migrationName: smokeName,
          tableName: smokeName,
          expectEmptyStderr: true,
        });

        const adoptionProject = await createConsumerProject(
          tempRoot,
          "adoption",
          tarball,
          ["pg@^8.16.3", "@types/pg@^8.15.5"]
        );
        const adoptionTableName = `adopted_accounts_${Date.now()}`;
        const followUpTableName = `adopted_notes_${Date.now()}`;
        const runAdoptionCli = (args: string[]) =>
          runCommand(
            [adoptionProject.bin("tusk"), ...args],
            adoptionProject.directory,
            commandEnv
          );

        await exerciseExistingDatabaseAdoption({
          runCli: runAdoptionCli,
          migrationsPath: join(adoptionProject.directory, "migrations"),
          pool: smokeDatabase.pool,
          existingTableName: adoptionTableName,
          followUpMigrationName: "add_adopted_notes",
          followUpTableName,
          expectEmptyStderr: true,
        });
      } else {
        const initResult = await runPackagedCli(["init", "--json"]);
        expectSuccess(initResult);
        expect(JSON.parse(initResult.stdout) as InitSmokePayload).toMatchObject({
          ok: true,
          command: "init",
          created: true,
        });

        const createResult = await runPackagedCli([
          "create",
          "smoke_test",
          "--json",
        ]);
        expectSuccess(createResult);
        const createPayload = JSON.parse(createResult.stdout) as CreateSmokePayload;
        expect(createPayload).toMatchObject({ ok: true, command: "create" });
        expect(await readdir(join(pgProject.directory, "migrations"))).toContain(
          createPayload.upFile
        );
      }

    } finally {
      await smokeDatabase?.cleanup();
    }

    await writeFile(
      join(pgProject.directory, "runtime.mjs"),
      `import { createPgAdapter } from ${JSON.stringify(`${packageName}/pg`)};
       console.log(typeof createPgAdapter);`
    );
    await writeFile(
      join(postgresProject.directory, "runtime.mjs"),
      `import { createPostgresJsAdapter } from ${JSON.stringify(`${packageName}/postgres`)};
       console.log(typeof createPostgresJsAdapter);`
    );
    await writeFile(
      join(elysiaProject.directory, "runtime.mjs"),
      `import { migrate } from ${JSON.stringify(`${packageName}/elysia`)};
       if (Number(process.versions.node.split(".")[0]) >= 20) {
         const [{ Elysia }, { Pool }] = await Promise.all([
           import("elysia"),
           import("pg"),
         ]);
         const pool = new Pool();
         const app = new Elysia().use(migrate({ pool, runOnStartup: false }));
         console.log(typeof app.use);
         await pool.end();
       } else {
         console.log(typeof migrate);
       }`
    );

    for (const project of [pgProject, postgresProject, elysiaProject]) {
      const runtimeResult = await runCommand(
        ["node", "runtime.mjs"],
        project.directory
      );
      expectSuccess(runtimeResult);
      expect(runtimeResult.stdout.trim()).toBe("function");
    }

    await Promise.all([
      typecheck(
        rootProject,
        `import {
           readMigrations,
           runUp,
           type MigrationAdapter,
           type QueryResult,
         } from ${JSON.stringify(packageName)};
         const result: QueryResult<{ id: number }> = { rows: [{ id: 1 }], rowCount: 1 };
         declare const adapter: MigrationAdapter;
         runUp(adapter, "./migrations");
         void result;
         void readMigrations;`
      ),
      typecheck(
        pgProject,
        `import { createPgAdapter } from ${JSON.stringify(`${packageName}/pg`)};
         import type { Pool } from "pg";
         declare const pool: Pool;
         createPgAdapter(pool);`
      ),
      typecheck(
        postgresProject,
        `import postgres from "postgres";
         import { createPostgresJsAdapter } from ${JSON.stringify(`${packageName}/postgres`)};
         declare const sql: ReturnType<typeof postgres>;
         createPostgresJsAdapter(sql);`
      ),
      typecheck(
        elysiaProject,
        `import { migrate, type ElysiaMigrateConfig } from ${JSON.stringify(`${packageName}/elysia`)};
         const config: ElysiaMigrateConfig = { runOnStartup: false };
         migrate(config);`,
        // Elysia 1.4's published declarations do not pass an independent
        // strict library check; our declaration and runtime imports are still
        // verified while upstream library checking is skipped.
        true
      ),
    ]);

    for (const [project, driver] of [
      [pgProject, "pg"],
      [postgresProject, "postgres"],
    ] as const) {
      const response = await runMcpRequest(
        project,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "tusk_status",
            arguments: { migrationsPath: "migrations" },
          },
        },
        {
          DATABASE_URL: "postgresql://user:password@127.0.0.1:1/unreachable",
          TUSK_DRIVER: driver,
        }
      );
      expect(JSON.stringify(response)).not.toContain(
        "No supported Postgres client found"
      );
    }
  }, 120_000);
});
