import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run";

const logs: string[] = [];
const errors: string[] = [];
const originalLog = console.log;
const originalError = console.error;
const originalEnv = { ...process.env };

afterEach(async () => {
  logs.length = 0;
  errors.length = 0;
  console.log = originalLog;
  console.error = originalError;

  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});

const captureOutput = () => {
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
};

const withWorkspace = async (
  run: (workspace: string) => Promise<void>
) => {
  const workspace = await mkdtemp(join(tmpdir(), "tusk-run-cli-"));
  try {
    await run(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
};

describe("runCli", () => {
  test("prints global help for --help", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("Usage: tusk <command> [options]");
  });

  test("prints command help", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "help", "validate"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("tusk validate [--db] [--json]");
  });

  test("rejects unknown help topics", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "help", "nope"]);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Unknown help topic");
  });

  test("prints global help for bare help command", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("Usage: tusk <command> [options]");
  });

  test("prints the version without extra arguments", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "version"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/^tusk v\d+\.\d+\.\d+/);
  });

  test("rejects version when extra arguments are present", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "version", "extra"]);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(
      "version does not accept additional arguments"
    );
  });

  test("awaits command failures so --json errors stay on stdout", async () => {
    captureOutput();
    await withWorkspace(async (workspace) => {
      const code = await runCli(
        ["node", "tusk", "create", "../../../escaped", "--json"],
        workspace
      );
      expect(code).toBe(1);
      expect(errors).toEqual([]);
      expect(JSON.parse(logs.join(""))).toMatchObject({
        ok: false,
        command: "create",
        error: { code: "VALIDATION_ERROR" },
      });
    });
  });

  test("dispatches validate and returns machine-readable output", async () => {
    captureOutput();
    await withWorkspace(async (workspace) => {
      const code = await runCli(
        ["node", "tusk", "validate", "--json"],
        workspace
      );
      expect(code).toBe(0);
      expect(JSON.parse(logs.join(""))).toMatchObject({
        ok: true,
        command: "validate",
      });
    });
  });

  test("dispatches doctor and returns machine-readable output", async () => {
    captureOutput();
    await withWorkspace(async (workspace) => {
      delete process.env.DATABASE_URL;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;

      const code = await runCli(
        ["node", "tusk", "doctor", "--json"],
        workspace
      );
      expect(code).toBe(1);
      expect(JSON.parse(logs.join(""))).toMatchObject({
        ok: false,
        command: "doctor",
        result: "fail",
      });
    });
  });

  test("dispatches init and creates the migrations directory", async () => {
    captureOutput();
    await withWorkspace(async (workspace) => {
      const migrationsPath = join(workspace, "migrations");
      const code = await runCli(
        ["node", "tusk", "init", "--json"],
        migrationsPath
      );
      expect(code).toBe(0);
      expect(JSON.parse(logs.join(""))).toMatchObject({
        ok: true,
        command: "init",
        created: true,
      });
    });
  });

  test("dispatches up, down, and status config failures through JSON", async () => {
    captureOutput();
    await withWorkspace(async (workspace) => {
      delete process.env.DATABASE_URL;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;

      for (const command of ["up", "down", "status"] as const) {
        logs.length = 0;
        const code = await runCli(
          ["node", "tusk", command, "--json"],
          workspace
        );
        expect(code).toBe(1);
        expect(JSON.parse(logs.join(""))).toMatchObject({
          ok: false,
          command,
          error: { code: "CONFIGURATION_ERROR" },
        });
      }
    });
  });

  test("uses migrationsPath from tusk.config.json when env is unset", async () => {
    captureOutput();
    await withWorkspace(async (workspace) => {
      delete process.env.MIGRATIONS_PATH;
      const configuredMigrations = join(workspace, "configured-migrations");
      await writeFile(
        join(workspace, "tusk.config.json"),
        JSON.stringify({ migrationsPath: "configured-migrations" })
      );

      const previousCwd = process.cwd();
      process.chdir(workspace);
      try {
        const code = await runCli(["node", "tusk", "init", "--json"]);
        expect(code).toBe(0);
        expect(JSON.parse(logs.join(""))).toMatchObject({
          ok: true,
          command: "init",
          created: true,
          migrationsPath: configuredMigrations,
          absolutePath: configuredMigrations,
        });
      } finally {
        process.chdir(previousCwd);
      }
    });
  });
});
