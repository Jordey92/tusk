#!/usr/bin/env node

import "dotenv/config";
import { Pool } from "pg";
import { createPgAdapter } from "./adapters/pg.js";
import { runUp, runDown } from "./core/run-migrations.js";
import { createMigrationFile } from "./core/create-migration.js";
import { createInitialMigration } from "./core/init-migration.js";
import { getMigrationStatus } from "./core/migration-status.js";
import { createDownPlan, createUpPlan, type MigrationPlan } from "./core/plan-migrations.js";
import { validateMigrations } from "./core/validate-migrations.js";
import { logger } from "./utils/logger.js";
import { createConfigurationError, createValidationError, formatTuskError, isTuskError } from "./utils/errors.js";
import { createErrorPayload, createSuccessPayload, writeJson } from "./utils/cli-output.js";
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
  json: boolean;
  dryRun: boolean;
  checkDatabase: boolean;
  downAll: boolean;
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
  init            Generate baseline migration and mark it as applied
  up              Run all pending migrations
  down [n]        Roll back n migrations (defaults to 1; use --all for all)
  status          Show migration status
  validate        Validate migration files without applying them
  version         Show version number
  help            Show this help message

Options:
  --version, -v   Show version number
  --help, -h      Show this help message
  status:
    --exit-code   Exit 1 when migrations are pending, 0 when clean
    --json        Output machine-readable status as JSON
    --quiet       Show only the summary line
  validate:
    --db          Include read-only database state checks
    --json        Output machine-readable validation data
  up/down:
    --dry-run     Print the ordered migration plan without applying SQL
    --json        Output machine-readable command data
  down:
    --all         Roll back all applied migrations

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
  tusk down --all
  tusk status
  tusk status --exit-code
  tusk status --json
  tusk status --quiet
  tusk validate
  tusk validate --db --json
  tusk up --dry-run
  tusk --version
`);
};

const parseCommandArgs = (command: string, rawArgs: string[]): ParsedCommandArgs => {
  const parsed: ParsedCommandArgs = {
    json: false,
    dryRun: false,
    checkDatabase: false,
    downAll: false,
    status: {
      exitCode: false,
      json: false,
      quiet: false,
    },
  };

  if (command === "down") {
    for (const rawArg of rawArgs) {
      if (rawArg === "--json") {
        parsed.json = true;
        continue;
      }

      if (rawArg === "--dry-run") {
        parsed.dryRun = true;
        continue;
      }

      if (rawArg === "--all") {
        if (parsed.downCount) {
          throw createValidationError(
            "Down command cannot combine --all with a count",
            { command, args: rawArgs }
          );
        }

        parsed.downAll = true;
        continue;
      }

      if (rawArg.startsWith("-")) {
        throw createValidationError(
          `Unknown down option: ${rawArg}. Valid options: --dry-run, --json, --all`,
          { command, arg: rawArg }
        );
      }

      if (parsed.downAll) {
        throw createValidationError(
          "Down command cannot combine --all with a count",
          { command, args: rawArgs }
        );
      }

      if (parsed.downCount) {
        throw createValidationError(
          "Down command accepts at most one optional count argument",
          { command, args: rawArgs }
        );
      }

      parsed.downCount = rawArg;
    }

    return parsed;
  }

  if (command === "create") {
    const positionalArgs = [];

    for (const rawArg of rawArgs) {
      if (rawArg === "--json") {
        parsed.json = true;
        continue;
      }

      positionalArgs.push(rawArg);
    }

    if (positionalArgs.length > 1) {
      throw createValidationError(
        "Create command accepts exactly one migration name argument",
        { command, args: positionalArgs }
      );
    }

    parsed.downCount = positionalArgs[0];
    return parsed;
  }

  if (command === "up") {
    for (const rawArg of rawArgs) {
      if (rawArg === "--json") {
        parsed.json = true;
        continue;
      }

      if (rawArg === "--dry-run") {
        parsed.dryRun = true;
        continue;
      }

      throw createValidationError(
        `Unknown up option: ${rawArg}. Valid options: --dry-run, --json`,
        { command, arg: rawArg }
      );
    }

    return parsed;
  }

  if (command === "init") {
    for (const rawArg of rawArgs) {
      if (rawArg === "--json") {
        parsed.json = true;
        continue;
      }

      throw createValidationError(
        `Unknown init option: ${rawArg}. Valid options: --json`,
        { command, arg: rawArg }
      );
    }

    return parsed;
  }

  if (command === "validate") {
    for (const rawArg of rawArgs) {
      if (rawArg === "--json") {
        parsed.json = true;
        continue;
      }

      if (rawArg === "--db") {
        parsed.checkDatabase = true;
        continue;
      }

      throw createValidationError(
        `Unknown validate option: ${rawArg}. Valid options: --db, --json`,
        { command, arg: rawArg }
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
        parsed.json = true;
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

const parsePositiveInteger = (value: string) => {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    return undefined;
  }

  return count;
};

const getCliDownCount = (parsedArgs: ParsedCommandArgs) => {
  if (parsedArgs.downAll) {
    return undefined;
  }

  if (parsedArgs.downCount) {
    return parsePositiveInteger(parsedArgs.downCount);
  }

  return 1;
};

const validateCommand = (command: string, parsedArgs: ParsedCommandArgs, arg?: string) => {
  const validCommands = ["create", "init", "up", "down", "status", "validate", "version", "help"];

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
    const count = parsePositiveInteger(parsedArgs.downCount);
    if (count === undefined) {
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

const printStatus = (
  status: Awaited<ReturnType<typeof getMigrationStatus>>,
  quiet: boolean
) => {
  if (!quiet) {
    console.log("\nMigration Status:");
    console.log("─".repeat(60));
  }

  if (!quiet && status.executed.length > 0) {
    console.log("\nExecuted:");
    status.executed.forEach((migration) => {
      const date = migration.executedAt
        ? new Date(migration.executedAt).toLocaleString("en-US", {
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

  if (!quiet && status.pending.length > 0) {
    console.log("\nPending:");
    status.pending.forEach((migration) => {
      console.log(`  ⏳ ${migration.filename}`);
    });
  }

  if (!quiet) {
    console.log("\n─".repeat(60));
    console.log(`Total: ${status.summary.executed} executed, ${status.summary.pending} pending\n`);
  } else {
    console.log(`${status.summary.executed} executed, ${status.summary.pending} pending`);
  }
};

const printPlan = (plan: MigrationPlan) => {
  const action = plan.direction === "up" ? "execute" : "roll back";
  console.log(`Dry run: ${plan.summary.planned} migration(s) would ${action}`);

  for (const migration of plan.migrations) {
    console.log("\n" + "─".repeat(60));
    console.log(`${migration.filename}`);
    if (migration.rollbackOf) {
      console.log(`Rollback of: ${migration.rollbackOf}`);
    }
    if (migration.checksum) {
      console.log(`Checksum: ${migration.checksum}`);
    }
    console.log("\n" + migration.sql.trim());
  }

  if (plan.migrations.length > 0) {
    console.log("\n" + "─".repeat(60));
  }
};

const printValidation = (result: Awaited<ReturnType<typeof validateMigrations>>) => {
  if (result.issues.length === 0) {
    console.log(`✓ Validation passed (${result.summary.files} migration file(s))`);
    return;
  }

  for (const issue of result.issues) {
    const prefix = issue.severity === "error" ? "ERROR" : "WARN";
    const file = issue.filename ? ` ${issue.filename}` : "";
    console.log(`[${prefix}] ${issue.code}${file}: ${issue.message}`);
  }

  console.log(
    `Validation ${result.ok ? "passed" : "failed"}: ` +
      `${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`
  );
};

const runDatabaseCommand = async (
  command: DatabaseCommand,
  parsedArgs: ParsedCommandArgs
): Promise<number> => {
  const config = loadDatabaseConfig();
  const pool = new Pool(config);
  const adapter = createPgAdapter(pool);

  try {
    if (command === "init") {
      logger.info("Generating initial migration from database");
      const initResult = await createInitialMigration(adapter, migrationsPath);
      if (parsedArgs.json) {
        writeJson(createSuccessPayload("init", {
          upFile: initResult.upFile,
          downFile: initResult.downFile,
          tableCount: initResult.tableCount,
          checksum: initResult.checksum,
          markedAsExecuted: initResult.markedAsExecuted,
          migrationsPath,
        }));
      } else {
        console.log(`✓ Created ${initResult.upFile}`);
        console.log(`✓ Created ${initResult.downFile}`);
        console.log(`✓ Introspected ${initResult.tableCount} table(s)`);
        console.log(`✓ Marked ${initResult.upFile} as applied`);
      }
      logger.info("Initial migration created successfully", {
        upFile: initResult.upFile,
        downFile: initResult.downFile,
        tableCount: initResult.tableCount,
        checksum: initResult.checksum,
        markedAsExecuted: initResult.markedAsExecuted
      });
      return 0;
    }

    if (command === "up") {
      if (parsedArgs.dryRun) {
        logger.info("Planning up migrations");
        const plan = await createUpPlan(adapter, migrationsPath);

        if (parsedArgs.json) {
          writeJson(createSuccessPayload("up", {
            dryRun: true,
            direction: plan.direction,
            migrations: plan.migrations,
            summary: plan.summary,
          }));
        } else {
          printPlan(plan);
        }

        return 0;
      }

      logger.info("Running up migrations");
      const upResult = await runUp(adapter, migrationsPath);
      if (parsedArgs.json) {
        writeJson(createSuccessPayload("up", upResult));
      } else {
        console.log(`✓ Executed ${upResult.executed} migration(s)`);
      }
      return 0;
    }

    if (command === "down") {
      const count = getCliDownCount(parsedArgs);
      if (parsedArgs.dryRun) {
        logger.info("Planning down migrations", { count });
        const plan = await createDownPlan(adapter, migrationsPath, count);

        if (parsedArgs.json) {
          writeJson(createSuccessPayload("down", {
            dryRun: true,
            direction: plan.direction,
            migrations: plan.migrations,
            summary: plan.summary,
          }));
        } else {
          printPlan(plan);
        }

        return 0;
      }

      logger.info("Running down migrations", { count });
      const downResult = await runDown(adapter, migrationsPath, count);
      if (parsedArgs.json) {
        writeJson(createSuccessPayload("down", downResult));
      } else {
        console.log(`✓ Rolled back ${downResult.executed} migration(s)`);
      }
      return 0;
    }

    logger.info("Checking migration status");
    const status = await getMigrationStatus(adapter, migrationsPath);

    if (parsedArgs.status.json) {
      writeJson(createSuccessPayload("status", status));

      if (parsedArgs.status.exitCode && status.summary.pending > 0) {
        return 1;
      }

      return 0;
    }

    printStatus(status, parsedArgs.status.quiet);

    if (parsedArgs.status.exitCode && status.summary.pending > 0) {
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
const rawJsonRequested = rawArgs.includes("--json");

if (rawJsonRequested) {
  process.env.LOG_LEVEL = "error";
}

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
    const primaryArg = parsedArgs.downCount;

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
      if (parsedArgs.json) {
        writeJson(createSuccessPayload("create", {
          ...files,
          migrationsPath,
        }));
      } else {
        console.log(`✓ Created ${files.upFile}`);
        console.log(`✓ Created ${files.downFile}`);
      }
      logger.info("Migration files created successfully", files);
      process.exit(0);
    }

    if (command === "validate") {
      if (parsedArgs.checkDatabase) {
        const config = loadDatabaseConfig();
        const pool = new Pool(config);
        const adapter = createPgAdapter(pool);

        try {
          const result = await validateMigrations(migrationsPath, {
            adapter,
            checkDatabase: true,
          });

          if (parsedArgs.json) {
            writeJson({ command: "validate", ...result });
          } else {
            printValidation(result);
          }

          process.exit(result.ok ? 0 : 1);
        } finally {
          await pool.end();
        }
      }

      const result = await validateMigrations(migrationsPath);
      if (parsedArgs.json) {
        writeJson({ command: "validate", ...result });
      } else {
        printValidation(result);
      }

      process.exit(result.ok ? 0 : 1);
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
    if (rawJsonRequested) {
      writeJson(createErrorPayload(error, command));
      process.exit(1);
    }

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
