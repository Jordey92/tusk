#!/usr/bin/env bun

import { Pool } from "pg";
import { createPostgresAdapter } from "./adapters/postgres";
import { runUp, runDown } from "./core/run-migrations";
import {
  ensureMigrationsTable,
  getExecutedMigrations,
} from "./core/track-migrations";
import { createMigrationFile } from "./core/create-migration";
import { logger } from "./utils/logger";
import { createConfigurationError, createValidationError, formatTuskError, isTuskError } from "./utils/errors";
import { readFileSync } from "fs";
import { resolve } from "path";

const validateDatabaseConfig = (config: any) => {
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
    throw new Error(formatTuskError(tuskError));
  }
};

const loadDatabaseConfig = () => {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  const config = {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };

  validateDatabaseConfig(config);
  return config;
};

const getVersion = () => {
  try {
    const packagePath = resolve(import.meta.dir, "./package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
    return packageJson.version;
  } catch {
    return "unknown";
  }
};

const showVersion = () => {
  console.log(`tusk v${getVersion()}`);
};

const showHelp = () => {
  console.log(`
Tusk - Simple PostgreSQL migration tool

Usage: tusk <command> [options]

Commands:
  create <name>   Create a new migration with the given name
  up              Run all pending migrations
  down [n]        Rollback last n migrations (defaults to all if n not specified)
  status          Show migration status
  version         Show version number
  help            Show this help message

Options:
  --version, -v   Show version number
  --help, -h      Show this help message

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
  tusk up
  tusk down
  tusk down 3
  tusk status
  tusk --version
`);
};

const validateCommand = (command: string, arg?: string) => {
  const validCommands = ["create", "up", "down", "status", "version", "help"];

  if (!validCommands.includes(command)) {
    const tuskError = createValidationError(
      `Unknown command: ${command}. Valid commands: ${validCommands.join(", ")}`,
      { command, validCommands }
    );
    throw new Error(formatTuskError(tuskError));
  }

  if (command === "create" && !arg) {
    const tuskError = createValidationError(
      "Migration name required for create command",
      { command }
    );
    throw new Error(formatTuskError(tuskError));
  }

  if (command === "down" && arg) {
    const count = parseInt(arg);
    if (isNaN(count) || count < 1) {
      const tuskError = createValidationError(
        "Count must be a positive integer for down command",
        { command, arg }
      );
      throw new Error(formatTuskError(tuskError));
    }
  }
};

const migrationsPath = process.env.MIGRATIONS_PATH || "./migrations";
const command = process.argv[2];
const arg = process.argv[3];

// Handle flags and help/version commands
if (!command || command === "help" || command === "--help" || command === "-h") {
  showHelp();
  process.exit(0);
}

if (command === "version" || command === "--version" || command === "-v") {
  showVersion();
  process.exit(0);
}

const run = async () => {
  try {
    validateCommand(command, arg);
    logger.info("Starting tusk migration tool", { command, arg, migrationsPath });

    const config = loadDatabaseConfig();
    const pool = new Pool(config);
    const adapter = createPostgresAdapter(pool);

    await ensureMigrationsTable(adapter);

    switch (command) {
      case "create":
        logger.info("Creating migration", { name: arg });
        const files = await createMigrationFile(migrationsPath, arg!);
        console.log(`✓ Created ${files.upFile}`);
        console.log(`✓ Created ${files.downFile}`);
        logger.info("Migration files created successfully", files);
        break;

      case "up":
        logger.info("Running up migrations");
        const upResult = await runUp(adapter, migrationsPath);
        console.log(`✓ Executed ${upResult.executed} migration(s)`);
        break;

      case "down":
        const count = arg ? parseInt(arg) : undefined;
        logger.info("Running down migrations", { count });
        const downResult = await runDown(adapter, migrationsPath, count);
        console.log(`✓ Rolled back ${downResult.executed} migration(s)`);
        break;

      case "status":
        logger.info("Checking migration status");
        const executed = await getExecutedMigrations(adapter);
        console.log(`Executed migrations: ${executed.size}`);
        executed.forEach((filename) => console.log(`  ✓ ${filename}`));
        break;

      case "version":
        showVersion();
        break;

      default:
        showHelp();
    }

    await pool.end();
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
