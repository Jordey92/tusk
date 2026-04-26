import { describe, expect, test } from "bun:test";
import { resolve } from "path";

const serverEntrypoint = resolve(process.cwd(), "mcp/server.ts");

const decode = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

describe("MCP server", () => {
  test("rejects invalid explicit rollback counts", async () => {
    const child = Bun.spawn([process.execPath, serverEntrypoint], {
      env: {
        ...process.env,
        LOG_LEVEL: "error",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "tusk_plan_down",
          arguments: {
            count: 0,
          },
        },
      })}\n`
    );
    child.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      decode(child.stdout),
      decode(child.stderr),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const response = JSON.parse(stdout.trim()) as {
      result: {
        isError: boolean;
        content: Array<{ text: string }>;
      };
    };
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]?.text).toContain(
      "count must be a positive integer"
    );
  });
});
