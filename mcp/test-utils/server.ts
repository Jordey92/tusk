import { expect } from "bun:test";
import { resolve } from "node:path";
import {
  runTestSubprocess,
  TestSubprocessTimeoutError,
} from "../../test-utils/subprocess";

const serverEntrypoint = resolve(process.cwd(), "mcp/server.ts");
const mcpAttemptTimeoutMs = 1_000;
const mcpRetryBackoffMs = 100;

interface McpCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  windowsVerbatimArguments?: boolean;
}

const readOnlyTools = new Set([
  "tusk_validate",
  "tusk_status",
  "tusk_plan_up",
  "tusk_plan_down",
]);

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;

const requestLabel = (request: Record<string, unknown>) => {
  const method = typeof request.method === "string"
    ? request.method
    : "unknown";
  const toolName = toRecord(request.params)?.name;
  return method === "tools/call" && typeof toolName === "string"
    ? `${method}:${toolName}`
    : method;
};

const isSafeToRetry = (request: Record<string, unknown>) => {
  if (
    request.method === "initialize" ||
    request.method === "ping" ||
    request.method === "tools/list"
  ) {
    return true;
  }

  if (request.method !== "tools/call") {
    return false;
  }

  const toolName = toRecord(request.params)?.name;
  return typeof toolName === "string" && readOnlyTools.has(toolName);
};

const parseResponse = (
  stdout: string,
  request: Record<string, unknown>,
): Record<string, unknown> => {
  let matching: Record<string, unknown> | undefined;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const message = toRecord(JSON.parse(trimmed));
      if (!message || message.jsonrpc !== "2.0") {
        throw new Error("stdout contained a non-JSON-RPC message");
      }
      if (!Object.hasOwn(message, "id")) {
        if (typeof message.method === "string") {
          continue;
        }
        throw new Error("stdout contained an invalid JSON-RPC notification");
      }
      if (message.id !== request.id) {
        throw new Error(
          `stdout contained unexpected response id ${String(message.id)}`,
        );
      }
      const hasResult = Object.hasOwn(message, "result");
      const hasError = Object.hasOwn(message, "error");
      if (hasResult === hasError) {
        throw new Error("stdout response must contain exactly one of result or error");
      }
      if (matching) {
        throw new Error("stdout contained more than one matching response");
      }
      matching = message;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("stdout contained malformed JSON before the MCP response");
      }
      throw error;
    }
  }
  if (!matching) {
    throw new Error(
      `MCP server returned no matching JSON-RPC response for ${requestLabel(request)}`,
    );
  }
  return matching;
};

export const sendMcpRequestToCommand = async (
  command: string[],
  request: Record<string, unknown>,
  env: Record<string, string> = {},
  options: McpCommandOptions = {},
) => {
  const attempts = isSafeToRetry(request) ? 2 : 1;
  const label = requestLabel(request);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await runTestSubprocess(command, {
        cwd: options.cwd,
        env: {
          ...process.env,
          LOG_LEVEL: "error",
          ...env,
        },
        stdin: `${JSON.stringify(request)}\n`,
        timeoutMs: options.timeoutMs ?? mcpAttemptTimeoutMs,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
      });

      expect(result.exitCode, result.stderr || result.stdout).toBe(0);
      expect(result.stderr).toBe("");
      return parseResponse(result.stdout, request);
    } catch (error) {
      const noOutputTimeout =
        error instanceof TestSubprocessTimeoutError &&
        error.stdout === "" &&
        error.stderr === "";
      if (!noOutputTimeout || attempt === attempts) {
        throw error;
      }

      console.warn(
        `MCP request timed out; retrying attempt ${attempt + 1}/${attempts}: ${label}`,
      );
      await new Promise((resolve) => setTimeout(resolve, mcpRetryBackoffMs));
    }
  }

  throw new Error("MCP request attempt loop completed unexpectedly");
};

export const sendMcpRequest = async (
  request: Record<string, unknown>,
  env: Record<string, string> = {},
) => sendMcpRequestToCommand(
  [process.execPath, serverEntrypoint],
  request,
  env,
);

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
