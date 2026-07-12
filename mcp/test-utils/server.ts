import { expect } from "bun:test";
import { resolve } from "node:path";

const serverEntrypoint = resolve(process.cwd(), "mcp/server.ts");

const decode = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

export const sendMcpRequest = async (
  request: Record<string, unknown>,
  env: Record<string, string> = {},
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

export const callMcpTool = async (
  name: string,
  args: Record<string, unknown>,
  env: Record<string, string> = {},
) => {
  return sendMcpRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
    env,
  ) as Promise<{
    result: {
      isError: boolean;
      content: Array<{ text: string }>;
    };
  }>;
};
