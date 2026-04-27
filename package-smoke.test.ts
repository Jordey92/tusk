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
import { join, resolve } from "path";
import { Pool } from "pg";
import {
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
    const packageParentDir = packageScope
      ? join(projectDir, "node_modules", packageScope)
      : join(projectDir, "node_modules");
    const installedPackageDir = join(packageParentDir, packageBaseName);
    const cliEntrypoint = join(installedPackageDir, "dist", "cli.js");
    const commandEnv = {
      LOG_LEVEL: "error",
      MIGRATIONS_PATH: "migrations",
      ...(packageSmokeDatabaseUrl
        ? { DATABASE_URL: packageSmokeDatabaseUrl }
        : {}),
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
    await mkdir(join(projectDir, "migrations"), { recursive: true });

    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "package-smoke", type: "module", private: true })
    );
    await writeFile(
      join(projectDir, "smoke.mjs"),
      `
      import { readMigrations } from ${JSON.stringify(packageName)};

      const migrations = await readMigrations("./migrations");
      console.log(migrations.map((migration) => migration.filename).join(","));
      `
    );

    const versionResult = await runCommand(
      [nodeBinary, cliEntrypoint, "version"],
      projectDir,
      commandEnv
    );
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout).toContain("tusk v");

    const runPackagedCli = (args: string[]) =>
      runCommand([nodeBinary, cliEntrypoint, ...args], projectDir, commandEnv);

    let upFile: string | undefined;

    if (packageSmokeDatabaseUrl) {
      const pool = new Pool({ connectionString: packageSmokeDatabaseUrl });
      const smokeName = `smoke_test_${Date.now()}`;

      try {
        ({ upFile } = await exerciseMigrationLifecycle({
          runCli: runPackagedCli,
          migrationsPath: join(projectDir, "migrations"),
          pool,
          migrationName: smokeName,
          tableName: smokeName,
        }));
      } finally {
        await pool.end();
      }
    } else {
      const createResult = await runPackagedCli(["create", "smoke_test"]);
      expect(createResult.exitCode).toBe(0);
      expect(createResult.stdout).toContain("Created");

      const createdFiles = await readdir(join(projectDir, "migrations"));
      upFile = createdFiles.find((file) => file.endsWith(".up.sql"));
      expect(upFile).toBeDefined();
    }

    const apiResult = await runCommand(
      [nodeBinary, "smoke.mjs"],
      projectDir,
      commandEnv
    );
    expect(apiResult.exitCode).toBe(0);
    expect(apiResult.stdout).toContain(upFile!);
  }, 20_000);
});
