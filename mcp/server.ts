#!/usr/bin/env node

import { Pool } from "pg";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { createPgAdapter } from "../adapters/pg.js";
import { createMigrationFile } from "../core/create-migration.js";
import { getMigrationStatus } from "../core/migration-status.js";
import {
  createDownPlan,
  createUpPlan,
  type MigrationPlan,
} from "../core/plan-migrations.js";
import {
  validateMigrations,
  type ValidationResult,
} from "../core/validate-migrations.js";
import type { MigrationStatusPayload } from "../types/cli.js";
import { getPackageVersion } from "../utils/version.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, JsonValue> & {
    name?: string;
    arguments?: Record<string, JsonValue>;
    protocolVersion?: string;
  };
}

interface JsonSchemaProperty {
  type: "string" | "boolean" | "number";
  default?: JsonValue;
  minimum?: number;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

type ToolResult =
  | ValidationResult
  | MigrationStatusPayload
  | MigrationPlan
  | Awaited<ReturnType<typeof createMigrationFile>>;

interface ToolErrorResult {
  error: string;
}

interface ToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError: boolean;
}

interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools: Record<string, never>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

interface ToolsListResult {
  tools: ToolDefinition[];
}

type JsonRpcResult =
  | InitializeResult
  | ToolsListResult
  | ToolResponse
  | Record<string, never>;

interface JsonRpcSuccessMessage {
  jsonrpc: "2.0";
  id: JsonRpcRequest["id"];
  result: JsonRpcResult;
}

interface JsonRpcErrorMessage {
  jsonrpc: "2.0";
  id: JsonRpcRequest["id"];
  error: {
    code: number;
    message: string;
  };
}

type JsonRpcMessage = JsonRpcSuccessMessage | JsonRpcErrorMessage;

const defaultMigrationsPath = "./migrations";

const tools: ToolDefinition[] = [
  {
    name: "tusk_validate",
    description: "Validate migration files. Optional database checks are read-only.",
    inputSchema: {
      type: "object",
      properties: {
        migrationsPath: { type: "string", default: defaultMigrationsPath },
        checkDatabase: { type: "boolean", default: false },
        databaseUrl: { type: "string" },
      },
    },
  },
  {
    name: "tusk_status",
    description: "Return migration status for a configured PostgreSQL database.",
    inputSchema: {
      type: "object",
      properties: {
        migrationsPath: { type: "string", default: defaultMigrationsPath },
        databaseUrl: { type: "string" },
      },
    },
  },
  {
    name: "tusk_plan_up",
    description: "Return the ordered up-migration dry-run plan without applying SQL.",
    inputSchema: {
      type: "object",
      properties: {
        migrationsPath: { type: "string", default: defaultMigrationsPath },
        databaseUrl: { type: "string" },
      },
    },
  },
  {
    name: "tusk_plan_down",
    description: "Return the ordered down-migration dry-run plan without applying SQL.",
    inputSchema: {
      type: "object",
      properties: {
        migrationsPath: { type: "string", default: defaultMigrationsPath },
        databaseUrl: { type: "string" },
        count: { type: "number", minimum: 1 },
      },
    },
  },
  {
    name: "tusk_create_migration",
    description: "Create paired .up.sql and .down.sql migration files.",
    inputSchema: {
      type: "object",
      properties: {
        migrationsPath: { type: "string", default: defaultMigrationsPath },
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
];

const hasArg = (args: Record<string, JsonValue>, key: string) =>
  Object.prototype.hasOwnProperty.call(args, key);

const isInteger = (value: unknown): value is number =>
  Number.isInteger(value);

const stringArg = (
  args: Record<string, JsonValue>,
  key: string,
  fallback: string
): string => {
  if (!hasArg(args, key)) {
    return fallback;
  }

  const value = args[key];
  if (typeof value === "string") {
    return value;
  }

  throw new Error(`${key} must be a string`);
};

const optionalStringArg = (
  args: Record<string, JsonValue>,
  key: string
): string | undefined => {
  if (!hasArg(args, key)) {
    return undefined;
  }

  const value = args[key];
  if (typeof value === "string") {
    return value.length > 0 ? value : undefined;
  }

  throw new Error(`${key} must be a string`);
};

const booleanArg = (
  args: Record<string, JsonValue>,
  key: string,
  fallback: boolean
): boolean => {
  if (!hasArg(args, key)) {
    return fallback;
  }

  const value = args[key];
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`${key} must be a boolean`);
};

const optionalPositiveInteger = (
  args: Record<string, JsonValue>,
  key: string
): number | undefined => {
  if (!hasArg(args, key)) {
    return undefined;
  }

  const value = args[key];
  if (!isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
};

const createPool = (args: Record<string, JsonValue> = {}) => {
  const databaseUrl = optionalStringArg(args, "databaseUrl") ??
    process.env.DATABASE_URL;

  if (databaseUrl) {
    return new Pool({ connectionString: databaseUrl });
  }

  return new Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
};

const withAdapter = async <T>(
  args: Record<string, JsonValue>,
  callback: (adapter: ReturnType<typeof createPgAdapter>) => Promise<T>
): Promise<T> => {
  const pool = createPool(args);
  const adapter = createPgAdapter(pool);

  try {
    return await callback(adapter);
  } finally {
    await pool.end();
  }
};

const callTool = async (
  name: string,
  args: Record<string, JsonValue> = {}
): Promise<ToolResult> => {
  const migrationsPath = stringArg(
    args,
    "migrationsPath",
    defaultMigrationsPath
  );

  if (name === "tusk_validate") {
    const checkDatabase = booleanArg(args, "checkDatabase", false);

    if (!checkDatabase) {
      return await validateMigrations(migrationsPath);
    }

    return await withAdapter(args, (adapter) =>
      validateMigrations(migrationsPath, {
        adapter,
        checkDatabase: true,
      })
    );
  }

  if (name === "tusk_status") {
    return await withAdapter(args, (adapter) =>
      getMigrationStatus(adapter, migrationsPath)
    );
  }

  if (name === "tusk_plan_up") {
    return await withAdapter(args, (adapter) =>
      createUpPlan(adapter, migrationsPath)
    );
  }

  if (name === "tusk_plan_down") {
    return await withAdapter(args, (adapter) =>
      createDownPlan(adapter, migrationsPath, optionalPositiveInteger(args, "count"))
    );
  }

  if (name === "tusk_create_migration") {
    const migrationName = optionalStringArg(args, "name");

    if (!migrationName) {
      throw new Error("tusk_create_migration requires a non-empty name");
    }

    return await createMigrationFile(migrationsPath, migrationName);
  }

  throw new Error(`Unknown tool: ${name}`);
};

const createToolResponse = (
  result: ToolResult | ToolErrorResult,
  isError = false
): ToolResponse => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(result, null, 2),
    },
  ],
  isError,
});

const writeMessage = (message: JsonRpcMessage) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const writeResult = (id: JsonRpcRequest["id"], result: JsonRpcResult) => {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
};

const writeError = (
  id: JsonRpcRequest["id"],
  code: number,
  message: string
) => {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
};

const handleRequest = async (request: JsonRpcRequest) => {
  if (request.id === undefined || request.id === null) {
    return;
  }

  if (request.method === "initialize") {
    const version = await getPackageVersion(dirname(fileURLToPath(import.meta.url)));
    const requestedProtocolVersion =
      typeof request.params?.protocolVersion === "string"
        ? request.params.protocolVersion
        : "2025-06-18";

    writeResult(request.id, {
      protocolVersion: requestedProtocolVersion,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "@bydey/tusk",
        version,
      },
    });
    return;
  }

  if (request.method === "tools/list") {
    writeResult(request.id, { tools });
    return;
  }

  if (request.method === "tools/call") {
    const toolName = request.params?.name;

    if (!toolName) {
      writeResult(request.id, createToolResponse({ error: "Missing tool name" }, true));
      return;
    }

    try {
      const result = await callTool(toolName, request.params?.arguments ?? {});
      writeResult(request.id, createToolResponse(result));
    } catch (error) {
      writeResult(
        request.id,
        createToolResponse(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          true
        )
      );
    }
    return;
  }

  if (request.method === "ping") {
    writeResult(request.id, {});
    return;
  }

  writeError(request.id, -32601, `Method not found: ${request.method}`);
};

let buffer = "";
let requestQueue = Promise.resolve();

const enqueueRequest = (request: JsonRpcRequest) => {
  requestQueue = requestQueue
    .then(() => handleRequest(request))
    .catch((error) => {
      writeError(
        request.id ?? null,
        -32603,
        error instanceof Error ? error.message : String(error)
      );
    });
};

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      enqueueRequest(JSON.parse(trimmed) as JsonRpcRequest);
    } catch (error) {
      writeError(
        null,
        -32700,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
});
