import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestSubprocessTimeoutError } from "../../test-utils/subprocess";
import { sendMcpRequestToCommand } from "./server";

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2026-01-01" },
};

describe("MCP test server process", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  test("retries a safe request only when no response was produced", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-retry-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile, readFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        const attempts = (await readFile(${JSON.stringify(attemptsPath)}, "utf8"))
          .trim()
          .split("\\n").length;
        if (attempts === 1) await new Promise(() => undefined);
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2026-01-01" },
        }));
      `,
    );

    const response = await sendMcpRequestToCommand(
      [process.execPath, fixture],
      initializeRequest,
      {},
      { cwd: workspace, timeoutMs: 500 },
    );

    expect(response.result).toEqual({ protocolVersion: "2026-01-01" });
    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(2);
  });

  test("does not retry a mutating tool call after a no-response timeout", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-mutation-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        await new Promise(() => undefined);
      `,
    );

    await expect(
      sendMcpRequestToCommand(
        [process.execPath, fixture],
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "tusk_create_migration",
            arguments: { name: "widgets" },
          },
        },
        {},
        { cwd: workspace, timeoutMs: 500 },
      ),
    ).rejects.toBeInstanceOf(TestSubprocessTimeoutError);

    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(1);
  });

  test("does not retry a safe request that emitted an invalid response", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-invalid-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        console.log("not-json-rpc");
        console.log(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
      `,
    );

    await expect(
      sendMcpRequestToCommand(
        [process.execPath, fixture],
        initializeRequest,
        {},
        { cwd: workspace, timeoutMs: 500 },
      ),
    ).rejects.toThrow("stdout contained malformed JSON before the MCP response");

    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(1);
  });

  test("rejects an unexpected response id before the matching response", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-wrong-id-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        console.log(JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} }));
        console.log(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
      `,
    );

    await expect(
      sendMcpRequestToCommand(
        [process.execPath, fixture],
        initializeRequest,
        {},
        { cwd: workspace, timeoutMs: 500 },
      ),
    ).rejects.toThrow("stdout contained unexpected response id 2");

    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(1);
  });

  test("rejects a response containing both result and error", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-result-error-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {},
          error: { code: -32603, message: "unexpected" },
        }));
      `,
    );

    await expect(
      sendMcpRequestToCommand(
        [process.execPath, fixture],
        initializeRequest,
        {},
        { cwd: workspace, timeoutMs: 500 },
      ),
    ).rejects.toThrow("stdout response must contain exactly one of result or error");

    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(1);
  });

  test("retries both empty safe-request timeouts and then fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-empty-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        await new Promise(() => undefined);
      `,
    );

    await expect(
      sendMcpRequestToCommand(
        [process.execPath, fixture],
        initializeRequest,
        {},
        { cwd: workspace, timeoutMs: 500 },
      ),
    ).rejects.toBeInstanceOf(TestSubprocessTimeoutError);

    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(2);
  });

  test("treats whitespace output as evidence and does not retry", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-whitespace-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        process.stdout.write("   ");
        await new Promise(() => undefined);
      `,
    );

    await expect(
      sendMcpRequestToCommand(
        [process.execPath, fixture],
        initializeRequest,
        {},
        { cwd: workspace, timeoutMs: 500 },
      ),
    ).rejects.toBeInstanceOf(TestSubprocessTimeoutError);

    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(1);
  });

  test("does not accept a valid response from a process that exits non-zero", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-exit-one-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2026-01-01" },
        }));
        process.exit(1);
      `,
    );

    await expect(
      sendMcpRequestToCommand(
        [process.execPath, fixture],
        initializeRequest,
        {},
        { cwd: workspace, timeoutMs: 500 },
      ),
    ).rejects.toThrow();

    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(1);
  });

  test("does not accept or retry a valid response from a hanging process", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tusk-mcp-response-hang-"));
    const fixture = join(workspace, "fixture.ts");
    const attemptsPath = join(workspace, "attempts");
    cleanupPaths.push(workspace);

    await writeFile(
      fixture,
      `
        import { appendFile } from "node:fs/promises";
        await appendFile(${JSON.stringify(attemptsPath)}, "attempt\\n");
        console.log(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2026-01-01" },
        }));
        await new Promise(() => undefined);
      `,
    );

    await expect(
      sendMcpRequestToCommand(
        [process.execPath, fixture],
        initializeRequest,
        {},
        { cwd: workspace, timeoutMs: 500 },
      ),
    ).rejects.toBeInstanceOf(TestSubprocessTimeoutError);

    expect((await readFile(attemptsPath, "utf8")).trim().split("\n"))
      .toHaveLength(1);
  });
});
