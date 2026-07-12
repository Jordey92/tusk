import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";

const serverEntrypoint = resolve(process.cwd(), "mcp/server.ts");

const decode = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

const callTool = async (
  name: string,
  args: Record<string, unknown>,
  env: Record<string, string> = {}
) => {
  return sendRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  }, env) as Promise<{
    result: {
      isError: boolean;
      content: Array<{ text: string }>;
    };
  }>;
};

const sendRequest = async (
  request: Record<string, unknown>,
  env: Record<string, string> = {}
) => {
  const child = Bun.spawn([process.execPath, serverEntrypoint], {
    env: {
      ...process.env,
      LOG_LEVEL: "error",
      ...env,
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

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  return JSON.parse(stdout.trim());
};

describe("MCP server", () => {
  test("echoes the requested protocol version during initialization", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-01-01",
      },
    });

    expect(response.result.protocolVersion).toBe("2026-01-01");
    expect(response.result.serverInfo.name).toBe("@bydey/tusk");
  });

  test("responds to ping", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });

    expect(response.result).toEqual({});
  });

  test("rejects invalid explicit rollback counts", async () => {
    const response = await callTool("tusk_plan_down", { count: 0 });

    expect(response.result.isError).toBe(true);
    expect(JSON.parse(response.result.content[0]!.text)).toEqual({
      error: "count must be a positive integer",
    });
  });

  test("rejects malformed string arguments instead of using defaults", async () => {
    const response = await callTool("tusk_validate", {
      migrationsPath: false,
    });

    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]?.text).toContain(
      "migrationsPath must be a string"
    );
  });

  test("rejects malformed boolean arguments instead of disabling checks", async () => {
    const response = await callTool("tusk_validate", {
      checkDatabase: "false",
    });

    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]?.text).toContain(
      "checkDatabase must be a boolean"
    );
  });

  test("rejects malformed baseline rollback overrides", async () => {
    const response = await callTool("tusk_plan_down", {
      allowBaselineRollback: "true",
    });

    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]?.text).toContain(
      "allowBaselineRollback must be a boolean"
    );
  });

  test("accepts both documented driver preferences and rejects unknown values", async () => {
    for (const driver of ["pg", "postgres"]) {
      const response = await callTool("tusk_status", {}, {
        TUSK_DRIVER: driver,
        DATABASE_URL: "",
      });
      expect(response.result.content[0]?.text).not.toContain(
        "TUSK_DRIVER must be pg or postgres"
      );
    }

    const invalidResponse = await callTool("tusk_status", {}, {
      TUSK_DRIVER: "mysql",
      DATABASE_URL: "",
    });
    expect(invalidResponse.result.content[0]?.text).toContain(
      "TUSK_DRIVER must be pg or postgres"
    );
  });

  test("creates migration files with explicit string arguments", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-create-"));
    const migrationsPath = join(workspace, "migrations");

    try {
      const response = await callTool("tusk_create_migration", {
        migrationsPath,
        name: "create_users",
      });

      expect(response.result.isError).toBe(false);

      const result = JSON.parse(response.result.content[0]!.text) as {
        upFile: string;
        downFile: string;
      };

      expect(result.upFile.endsWith("_create_users.up.sql")).toBe(true);
      expect(result.downFile.endsWith("_create_users.down.sql")).toBe(true);
      expect(await readdir(migrationsPath)).toEqual(
        expect.arrayContaining([result.upFile, result.downFile])
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
