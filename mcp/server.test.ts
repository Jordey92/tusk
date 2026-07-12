import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  callMcpTool as callTool,
  sendMcpRequest as sendRequest,
} from "./test-utils/server";

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

  test("publishes safe boolean defaults in the tool schemas", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const tools = response.result.tools as Array<{
      name: string;
      inputSchema: { properties: Record<string, { default?: unknown }> };
    }>;

    expect(
      tools.find((tool) => tool.name === "tusk_validate")?.inputSchema.properties
        .checkDatabase?.default
    ).toBe(false);
    expect(
      tools.find((tool) => tool.name === "tusk_plan_down")?.inputSchema.properties
        .allowBaselineRollback?.default
    ).toBe(false);
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

  test("validates without a database unless database checks are requested", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-validate-files-"));
    try {
      await writeFile(
        join(workspace, "1728123456789_widgets.up.sql"),
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);"
      );
      await writeFile(
        join(workspace, "1728123456789_widgets.down.sql"),
        "DROP TABLE widgets;"
      );
      const response = await callTool("tusk_validate", {
        migrationsPath: workspace,
      }, {
        DATABASE_URL: "",
        DB_HOST: "127.0.0.1",
        DB_PORT: "1",
        DB_NAME: "",
        DB_USER: "",
        DB_PASSWORD: "",
      });

      expect(response.result.isError).toBe(false);
      expect(JSON.parse(response.result.content[0]!.text)).toMatchObject({
        ok: true,
        issues: [],
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
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

  test("accepts a zero statement timeout", async () => {
    const response = await callTool("tusk_status", {}, {
      TUSK_STATEMENT_TIMEOUT_MS: "0",
      DATABASE_URL: "",
      DB_HOST: "127.0.0.1",
      DB_PORT: "1",
    });

    expect(response.result.content[0]?.text).not.toContain(
      "TUSK_STATEMENT_TIMEOUT_MS must be a non-negative integer"
    );
  });

  test("treats an empty databaseUrl argument as an omitted override", async () => {
    const migrationsPath = await mkdtemp(
      join(tmpdir(), "tusk-mcp-empty-database-url-"),
    );

    try {
      const response = await callTool(
        "tusk_status",
        { databaseUrl: "", migrationsPath },
        {
          DATABASE_URL:
            "postgresql://user:password@127.0.0.1:1/from_environment",
          DB_HOST: "127.0.0.1",
          DB_PORT: "2",
        },
      );

      expect(response.result.content[0]?.text).toContain("127.0.0.1:1");
      expect(response.result.content[0]?.text).not.toContain("127.0.0.1:2");
    } finally {
      await rm(migrationsPath, { recursive: true, force: true });
    }
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

  test("marks a missing tool name as an MCP tool error", async () => {
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { arguments: {} },
    });

    expect(response.result.isError).toBe(true);
    expect(JSON.parse(response.result.content[0].text)).toEqual({
      error: "Missing tool name",
    });
  });
});
