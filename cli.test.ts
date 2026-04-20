import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { exerciseMigrationLifecycle } from "./utils/cli-smoke";
import { createTemporaryDatabase } from "./utils/test-helper";

const cliEntrypoint = resolve(process.cwd(), "cli.ts");

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const decode = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

const runCli = async (
  args: string[],
  env: Record<string, string>,
  cwd: string
): Promise<CliResult> => {
  const child = Bun.spawn([process.execPath, cliEntrypoint, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
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

describe("cli smoke test", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  test("create works without database settings", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-cli-create-"));
    cleanupPaths.push(workspace);

    const result = await runCli(
      ["create", "widgets"],
      {
        MIGRATIONS_PATH: "migrations",
        LOG_LEVEL: "error",
      },
      workspace
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created");
    expect(result.stderr).toBe("");

    const createdFiles = await readdir(join(workspace, "migrations"));
    expect(createdFiles.some((file) => file.endsWith(".up.sql"))).toBe(true);
    expect(createdFiles.some((file) => file.endsWith(".down.sql"))).toBe(true);
  });

  test("create, up, status, and down work against a fresh database", async () => {
    const database = await createTemporaryDatabase("cli_smoke");
    const workspace = await mkdtemp(join(tmpdir(), "tusk-cli-smoke-"));
    const migrationsPath = join(workspace, "migrations");
    cleanupPaths.push(workspace);

    const env = {
      DATABASE_URL: database.connectionString,
      MIGRATIONS_PATH: "migrations",
      LOG_LEVEL: "error",
    };

    try {
      await exerciseMigrationLifecycle({
        runCli: (args) => runCli(args, env, workspace),
        migrationsPath,
        pool: database.pool,
        migrationName: "widgets",
        tableName: "widgets",
        expectEmptyStderr: true,
      });
    } finally {
      await database.cleanup();
    }
  });

  test("reports a configuration error when database settings are missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-cli-config-"));
    cleanupPaths.push(workspace);

    const result = await runCli(
      ["status"],
      {
        DATABASE_URL: "",
        DB_HOST: "",
        DB_PORT: "",
        DB_NAME: "",
        DB_USER: "",
        DB_PASSWORD: "",
        LOG_LEVEL: "error",
      },
      workspace
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required database configuration");
  });
});
