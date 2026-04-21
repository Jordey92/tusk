#!/usr/bin/env node

import "dotenv/config";
import { Pool } from "pg";
import { createPgAdapter } from "./adapters/pg.js";
import { runUp, runDown } from "./core/run-migrations.js";
import {
  ensureMigrationsTable,
  getExecutedMigrationsWithChecksums,
} from "./core/track-migrations.js";
import { createMigrationFile } from "./core/create-migration.js";
import { createInitialMigration } from "./core/init-migration.js";
import { readMigrations } from "./core/read-migrations.js";
import { logger } from "./utils/logger.js";
import { createConfigurationError, createValidationError, formatTuskError, isTuskError } from "./utils/errors.js";
import { getCurrentDir } from "./utils/runtime.js";
import { getPackageVersion } from "./utils/version.js";
import type { ConnectionConfig } from "./types/migrations.js";

interface DatabaseConfig extends ConnectionConfig {
  connectionString?: string;
}

interface StatusOptions {
  exitCode: boolean;
  json: boolean;
  quiet: boolean;
}

interface ParsedCommandArgs {
  downCount?: string;
  status: StatusOptions;
}

const validateDatabaseConfig = (config: DatabaseConfig) => {
  if (config.connectionString) {
    return;
  }

  const missing = [];
  if (!config.database) missing.push("DB_NAME");
  if (!config.user) missing.push("DB_USER");
  if (!config.password) missing.push("DB_PASSWORD");

  if (missing.length > 0) {
    const tuskError = createConfigurationError(
      `Missing required database configuration: ${missing.join(", ")}. ` +
      `Provide DATABASE_URL or individual environment variables.`,
      { missing }
    );
    throw tuskError;
  }
};

const loadDatabaseConfig = (): DatabaseConfig => {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  const config: DatabaseConfig = {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };

  validateDatabaseConfig(config);
  return config;
};

const getVersion = async () => {
  return getPackageVersion(getCurrentDir());
};

const showVersion = async () => {
  console.log(`tusk v${await getVersion()}`);
};

const showHelp = () => {
  console.log(`
Tusk - Simple PostgreSQL migration tool

Usage: tusk <command> [options]

Commands:
  create <name>   Create a new migration with the given name
  init            Generate initial migration from existing database schema
  up              Run all pending migrations
  down [n]        Rollback last n migrations (defaults to all if n not specified)
  status          Show migration status
  version         Show version number
  help            Show this help message

Options:
  --version, -v   Show version number
  --help, -h      Show this help message
  status:
    --exit-code   Exit 1 when migrations are pending, 0 when clean
    --json        Output machine-readable status as JSON
    --quiet       Show only the summary line

Environment variables:
  DATABASE_URL    PostgreSQL connection string
  Or individual variables:
    DB_HOST       Database host (default: localhost)
    DB_PORT       Database port (default: 5432)
    DB_NAME       Database name (required)
    DB_USER       Database user (required)
    DB_PASSWORD   Database password (required)
  MIGRATIONS_PATH Migration files directory (default: ./migrations)
  LOG_LEVEL       Logging level: debug, info, warn, error (default: info)

Examples:
  tusk create add_user_table
  tusk init
  tusk up
  tusk down
  tusk down 3
  tusk status
  tusk status --exit-code
  tusk status --json
  tusk status --quiet
  tusk --version
`);
};

const parseCommandArgs = (command: string, rawArgs: string[]): ParsedCommandArgs => {
  const parsed: ParsedCommandArgs = {
    status: {
      exitCode: false,
      json: false,
      quiet: false,
    },
  };

  if (command === "down") {
    if (rawArgs.length > 1) {
      throw createValidationError(
        "Down command accepts at most one optional count argument",
        { command, args: rawArgs }
      );
    }

    parsed.downCount = rawArgs[0];
    return parsed;
  }

  if (command === "create") {
    if (rawArgs.length > 1) {
      throw createValidationError(
        "Create command accepts exactly one migration name argument",
        { command, args: rawArgs }
      );
    }

    return parsed;
  }

  if (command === "status") {
    for (const rawArg of rawArgs) {
      if (rawArg === "--exit-code") {
        parsed.status.exitCode = true;
        continue;
      }

      if (rawArg === "--quiet") {
        parsed.status.quiet = true;
        continue;
      }

      if (rawArg === "--json") {
        parsed.status.json = true;
        continue;
      }

      throw createValidationError(
        `Unknown status option: ${rawArg}. Valid options: --exit-code, --quiet, --json`,
        { command, arg: rawArg }
      );
    }

    return parsed;
  }

  if (rawArgs.length > 0) {
    throw createValidationError(
      `${command} does not accept additional arguments`,
      { command, args: rawArgs }
    );
  }

  return parsed;
};

const validateCommand = (command: string, parsedArgs: ParsedCommandArgs, arg?: string) => {
  const validCommands = ["create", "init", "up", "down", "status", "version", "help"];

  if (!validCommands.includes(command)) {
    const tuskError = createValidationError(
      `Unknown command: ${command}. Valid commands: ${validCommands.join(", ")}`,
      { command, validCommands }
    );
    throw tuskError;
  }

  if (command === "create" && !arg) {
    const tuskError = createValidationError(
      "Migration name required for create command",
      { command }
    );
    throw tuskError;
  }

  if (command === "down" && parsedArgs.downCount) {
    const count = parseInt(parsedArgs.downCount);
    if (isNaN(count) || count < 1) {
      const tuskError = createValidationError(
        "Count must be a positive integer for down command",
        { command, arg: parsedArgs.downCount }
      );
      throw tuskError;
    }
  }

  if (command === "status" && parsedArgs.status.json && parsedArgs.status.quiet) {
    throw createValidationError(
      "Status options --json and --quiet cannot be combined",
      { command }
    );
  }
};

type DatabaseCommand = "init" | "up" | "down" | "status";

const runDatabaseCommand = async (
  command: DatabaseCommand,
  parsedArgs: ParsedCommandArgs
): Promise<number> => {
  const config = loadDatabaseConfig();
  const pool = new Pool(config);
  const adapter = createPgAdapter(pool);

  try {
    await ensureMigrationsTable(adapter);

    if (command === "init") {
      logger.info("Generating initial migration from database");
      const initResult = await createInitialMigration(adapter, migrationsPath);
      console.log(`✓ Created ${initResult.upFile}`);
      console.log(`✓ Created ${initResult.downFile}`);
      console.log(`✓ Introspected ${initResult.tableCount} table(s)`);
      logger.info("Initial migration created successfully", {
        upFile: initResult.upFile,
        downFile: initResult.downFile,
        tableCount: initResult.tableCount
      });
      return 0;
    }

    if (command === "up") {
      logger.info("Running up migrations");
      const upResult = await runUp(adapter, migrationsPath);
      console.log(`✓ Executed ${upResult.executed} migration(s)`);
      return 0;
    }

    if (command === "down") {
      const count = parsedArgs.downCount ? parseInt(parsedArgs.downCount) : undefined;
      logger.info("Running down migrations", { count });
      const downResult = await runDown(adapter, migrationsPath, count);
      console.log(`✓ Rolled back ${downResult.executed} migration(s)`);
      return 0;
    }

    logger.info("Checking migration status");
    const allMigrations = await readMigrations(migrationsPath, "up");
    const executedMigrations = await getExecutedMigrationsWithChecksums(adapter);
    const executedFilenames = new Set(executedMigrations.map((m) => m.filename));
    const executed = allMigrations.filter((m) => executedFilenames.has(m.filename));
    const pending = allMigrations.filter((m) => !executedFilenames.has(m.filename));

    if (parsedArgs.status.json) {
      const payload = {
        executed: executed.map((migration) => {
          const record = executedMigrations.find((m) => m.filename === migration.filename);

          return {
            filename: migration.filename,
            executedAt: record?.executed_at
              ? new Date(record.executed_at).toISOString()
              : null,
          };
        }),
        pending: pending.map((migration) => ({
          filename: migration.filename,
        })),
        summary: {
          executed: executed.length,
          pending: pending.length,
        },
      };

      console.log(JSON.stringify(payload));

      if (parsedArgs.status.exitCode && pending.length > 0) {
        return 1;
      }

      return 0;
    }

    if (!parsedArgs.status.quiet) {
      console.log("\nMigration Status:");
      console.log("─".repeat(60));
    }

    if (!parsedArgs.status.quiet && executed.length > 0) {
      console.log("\nExecuted:");
      executed.forEach((migration) => {
        const record = executedMigrations.find((m) => m.filename === migration.filename);
        const date = record?.executed_at
          ? new Date(record.executed_at).toLocaleString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })
          : "unknown";
        console.log(`  ✓ ${migration.filename} (${date})`);
      });
    }

    if (!parsedArgs.status.quiet && pending.length > 0) {
      console.log("\nPending:");
      pending.forEach((migration) => {
        console.log(`  ⏳ ${migration.filename}`);
      });
    }

    if (!parsedArgs.status.quiet) {
      console.log("\n─".repeat(60));
      console.log(`Total: ${executed.length} executed, ${pending.length} pending\n`);
    } else {
      console.log(`${executed.length} executed, ${pending.length} pending`);
    }

    if (parsedArgs.status.exitCode && pending.length > 0) {
      return 1;
    }

    return 0;
  } finally {
    await pool.end();
  }
};

const migrationsPath = process.env.MIGRATIONS_PATH || "./migrations";
const command = process.argv[2];
const rawArgs = process.argv.slice(3);

// Handle flags and help/version commands
if (!command || command === "help" || command === "--help" || command === "-h") {
  showHelp();
  process.exit(0);
}

if (command === "version" || command === "--version" || command === "-v") {
  await showVersion();
  process.exit(0);
}

const run = async () => {
  try {
    const parsedArgs = parseCommandArgs(command, rawArgs);
    const primaryArg = command === "create" ? rawArgs[0] : parsedArgs.downCount;

    validateCommand(command, parsedArgs, primaryArg);
    logger.info("Starting tusk migration tool", {
      command,
      arg: primaryArg,
      rawArgs,
      migrationsPath
    });

    if (command === "create") {
      logger.info("Creating migration", { name: primaryArg });
      const files = await createMigrationFile(migrationsPath, primaryArg!);
      console.log(`✓ Created ${files.upFile}`);
      console.log(`✓ Created ${files.downFile}`);
      logger.info("Migration files created successfully", files);
      process.exit(0);
    }

    if (command === "init" || command === "up" || command === "down" || command === "status") {
      const exitCode = await runDatabaseCommand(command, parsedArgs);
      logger.info("Migration tool completed successfully");
      process.exit(exitCode);
    }

    showHelp();
    logger.info("Migration tool completed successfully");
    process.exit(0);
  } catch (error) {
    if (isTuskError(error)) {
      logger.error("Tusk error occurred", { error: formatTuskError(error) });
      console.error(formatTuskError(error));
    } else {
      logger.error("Unexpected error occurred", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      console.error("Unexpected error:", error instanceof Error ? error.message : String(error));
    }

    process.exit(1);
  }
};

run();
