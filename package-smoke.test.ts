import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "fs/promises";
import { randomUUID } from "crypto";
import { join, resolve } from "path";
import { Pool } from "pg";
import {
  exerciseExistingDatabaseAdoption,
  exerciseMigrationLifecycle,
  type CliCommandResult,
} from "./utils/cli-smoke";

const repoRoot = process.cwd();
const nodeBinary = process.env.NODE_BINARY || "node";
const packageSmokeDatabaseUrl = process.env.TUSK_SMOKE_DATABASE_URL;
const skipPackageBuild = process.env.TUSK_PACKAGE_SMOKE_SKIP_BUILD === "1";

interface PackageJson {
  name: string;
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

describe("package smoke test", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  test("packed tarball exposes the installed CLI and public API", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(repoRoot, "package.json"), "utf-8")
    ) as PackageJson;
    const packageName = packageJson.name;
    const [packageScope, packageBaseName] = packageName.startsWith("@")
      ? packageName.split("/")
      : [undefined, packageName];
    const tempRootParent = resolve(repoRoot, ".tmp");
    await mkdir(tempRootParent, { recursive: true });

    const tempRoot = await mkdtemp(join(tempRootParent, "package-smoke-"));
    const projectDir = join(tempRoot, "project");
    const adoptionProjectDir = join(tempRoot, "adoption-project");
    const packageParentDir = packageScope
      ? join(projectDir, "node_modules", packageScope)
      : join(projectDir, "node_modules");
    const installedPackageDir = join(packageParentDir, packageBaseName);
    const cliEntrypoint = join(installedPackageDir, "dist", "cli.js");
    const baseCommandEnv = {
      LOG_LEVEL: "error",
      MIGRATIONS_PATH: "migrations",
    };
    cleanupPaths.push(tempRoot);

    if (!skipPackageBuild) {
      const buildResult = await runCommand(["bun", "run", "build"], repoRoot);
      expect(buildResult.exitCode).toBe(0);
    }

    const packResult = await runCommand(
      ["npm", "pack", "--pack-destination", tempRoot],
      repoRoot
    );
    expect(packResult.exitCode).toBe(0);

    const tarball = (await readdir(tempRoot)).find((file) => file.endsWith(".tgz"));
    expect(tarball).toBeDefined();

    await mkdir(packageParentDir, { recursive: true });

    const extractResult = await runCommand(
      ["tar", "-xzf", join(tempRoot, tarball!), "-C", packageParentDir],
      repoRoot
    );
    expect(extractResult.exitCode).toBe(0);

    await rename(join(packageParentDir, "package"), installedPackageDir);
    await mkdir(adoptionProjectDir, { recursive: true });

    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "package-smoke", type: "module", private: true })
    );
    await writeFile(
      join(adoptionProjectDir, "package.json"),
      JSON.stringify({
        name: "package-smoke-adoption",
        type: "module",
        private: true,
      })
    );
    await writeFile(
      join(projectDir, "smoke.mjs"),
      `
      import { readMigrations } from ${JSON.stringify(packageName)};

      const migrations = await readMigrations("./migrations");
      console.log(migrations.map((migration) => migration.filename).join(","));
      `
    );

    let smokeDatabase: PackageSmokeDatabase | undefined;

    if (packageSmokeDatabaseUrl) {
      smokeDatabase = await createPackageSmokeDatabase(packageSmokeDatabaseUrl);
    }

    const commandEnv = {
      ...baseCommandEnv,
      ...(smokeDatabase ? { DATABASE_URL: smokeDatabase.connectionString } : {}),
    };

    let upFile: string | undefined;

    try {
      const versionResult = await runCommand(
        [nodeBinary, cliEntrypoint, "version"],
        projectDir,
        commandEnv
      );
      expect(versionResult.exitCode).toBe(0);
      expect(versionResult.stdout).toContain("tusk v");

      const runPackagedCli = (args: string[]) =>
        runCommand([nodeBinary, cliEntrypoint, ...args], projectDir, commandEnv);

      if (smokeDatabase) {
        const smokeName = `smoke_test_${Date.now()}`;

        ({ upFile } = await exerciseMigrationLifecycle({
          runCli: runPackagedCli,
          migrationsPath: join(projectDir, "migrations"),
          pool: smokeDatabase.pool,
          migrationName: smokeName,
          tableName: smokeName,
          expectEmptyStderr: true,
        }));

        const adoptionTableName = `adopted_accounts_${Date.now()}`;
        const followUpTableName = `adopted_notes_${Date.now()}`;
        const runAdoptionCli = (args: string[]) =>
          runCommand(
            [nodeBinary, cliEntrypoint, ...args],
            adoptionProjectDir,
            commandEnv
          );

        await exerciseExistingDatabaseAdoption({
          runCli: runAdoptionCli,
          migrationsPath: join(adoptionProjectDir, "migrations"),
          pool: smokeDatabase.pool,
          existingTableName: adoptionTableName,
          followUpMigrationName: "add_adopted_notes",
          followUpTableName,
          expectEmptyStderr: true,
        });
      } else {
        const initResult = await runPackagedCli(["init", "--json"]);
        expect(initResult.exitCode).toBe(0);
        const initPayload = JSON.parse(initResult.stdout) as InitSmokePayload;
        expect(initPayload).toMatchObject({
          ok: true,
          command: "init",
          created: true,
        });

        const createResult = await runPackagedCli(["create", "smoke_test", "--json"]);
        expect(createResult.exitCode).toBe(0);
        const createPayload = JSON.parse(createResult.stdout) as CreateSmokePayload;
        expect(createPayload).toMatchObject({
          ok: true,
          command: "create",
        });

        const createdFiles = await readdir(join(projectDir, "migrations"));
        upFile = createPayload.upFile;
        expect(createdFiles).toContain(upFile);
      }
      const apiResult = await runCommand(
        [nodeBinary, "smoke.mjs"],
        projectDir,
        commandEnv
      );
      expect(apiResult.exitCode).toBe(0);
      expect(apiResult.stdout).toContain(upFile!);
    } finally {
      await smokeDatabase?.cleanup();
    }
  }, 30_000);
});
