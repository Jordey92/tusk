#!/usr/bin/env node

import "dotenv/config";
import {
  createManagedPostgresAdapter,
  resolvePostgresClientDriver,
  type ManagedPostgresAdapter,
} from "./adapters/postgres-client.js";
import { runUp, runDown } from "./core/run-migrations.js";
import { createMigrationFile } from "./core/create-migration.js";
import { createInitialMigration } from "./core/init-migration.js";
import { initializeProject } from "./core/init-project.js";
import { getMigrationStatus } from "./core/migration-status.js";
import { createDownPlan, createUpPlan, type MigrationPlan } from "./core/plan-migrations.js";
import { validateMigrations } from "./core/validate-migrations.js";
import { runDoctor } from "./core/doctor.js";
import { logger } from "./utils/logger.js";
import {
  createConfigurationError,
  formatTuskError,
  isDriverNotFoundError,
  isTuskError,
} from "./utils/errors.js";
import { createErrorPayload, createSuccessPayload, writeJson } from "./utils/cli-output.js";
import { formatDoctorReport } from "./utils/doctor-output.js";
import {
  getCliDownCount,
  parseCommandArgs,
  validateCommand,
  type ParsedCommandArgs,
} from "./utils/cli-parser.js";
import { getCurrentDir } from "./utils/runtime.js";
import { getPackageVersion } from "./utils/version.js";
import type { ConnectionConfig } from "./types/migrations.js";
import type { RollbackTarget } from "./core/rollback-target.js";

interface DatabaseConfig extends ConnectionConfig {
  connectionString?: string;
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
  init            Initialise a Tusk project locally
  init --from-db  Generate baseline migration and mark it as applied
  up              Run all pending migrations
  down [n]        Roll back n migrations (defaults to 1; use --all for all)
  status          Show migration status
  validate        Validate migration files without applying them
  doctor          Check whether Tusk can safely operate here
  version         Show version number
  help            Show this help message

Options:
  --version, -v   Show version number
  --help, -h      Show this help message
  init:
    --from-db     Adopt an existing database schema as an applied baseline
    --json        Output machine-readable init data
  status:
    --exit-code   Exit 1 when migrations are pending, 0 when clean
    --json        Output machine-readable status as JSON
    --quiet       Show only the summary line
  validate:
    --db          Include read-only database state checks
    --json        Output machine-readable validation data
  doctor:
    --json        Output machine-readable doctor data
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
  LOG_LEVEL       Logging level: debug, info, warn, error (default: warn)

Examples:
  tusk create add_user_table
  tusk init
  tusk init --from-db
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
  tusk doctor
  tusk doctor --json
  tusk up --dry-run
  tusk --version
`);
};

type DatabaseCommand = "up" | "down" | "status";

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
  if (
    plan.direction === "down" &&
    plan.summary.requestedCount !== undefined &&
    plan.summary.requestedCount > (plan.summary.availableRollbackCount ?? 0)
  ) {
    console.log(
      `Requested ${plan.summary.requestedCount} rollback(s), but only ` +
        `${plan.summary.availableRollbackCount ?? 0} applied migration(s) are available`
    );
  }

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

const getCliRollbackTarget = (parsedArgs: ParsedCommandArgs): RollbackTarget | undefined =>
  parsedArgs.downAll ? { all: true } : getCliDownCount(parsedArgs);

const printDownResult = (
  result: Awaited<ReturnType<typeof runDown>>
) => {
  if (result.executed === 0) {
    console.log("✓ No applied migrations to roll back");
    return;
  }

  if (
    result.requestedCount !== undefined &&
    result.requestedCount > (result.availableRollbackCount ?? 0)
  ) {
    console.log(
      `✓ Requested ${result.requestedCount} rollback(s), but only ` +
        `${result.availableRollbackCount ?? 0} applied migration(s) were available. ` +
        `Rolled back ${result.executed} migration(s)`
    );
    return;
  }

  console.log(`✓ Rolled back ${result.executed} migration(s)`);
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

const printDoctor = (report: Awaited<ReturnType<typeof runDoctor>>) => {
  console.log(formatDoctorReport(report));
};

const createDatabaseConnection = async (): Promise<ManagedPostgresAdapter> => {
  const config = loadDatabaseConfig();
  return createManagedPostgresAdapter(config);
};

const createDriverNotFoundDoctorInput = (error: unknown) => {
  try {
    loadDatabaseConfig();
    return {
      database: {
        state: "driver_missing" as const,
        configuration: "found" as const,
        error,
      },
      cleanup: async () => {},
    };
  } catch {
    return {
      database: {
        state: "driver_missing" as const,
        configuration: "missing" as const,
        error,
      },
      cleanup: async () => {},
    };
  }
};

const createDoctorDatabaseInput = async () => {
  try {
    await resolvePostgresClientDriver();
  } catch (error) {
    return createDriverNotFoundDoctorInput(error);
  }

  let config: DatabaseConfig;

  try {
    config = loadDatabaseConfig();
  } catch (error) {
    return {
      database: {
        state: "not_configured" as const,
        error,
      },
      cleanup: async () => {},
    };
  }

  try {
    const database = await createManagedPostgresAdapter(config);
    return {
      database: {
        state: "configured" as const,
        adapter: database.adapter,
      },
      cleanup: database.cleanup,
    };
  } catch (error) {
    return {
      database: {
        state: "connection_failed" as const,
        error,
      },
      cleanup: async () => {},
    };
  }
};

const runDatabaseCommand = async (
  command: DatabaseCommand,
  parsedArgs: ParsedCommandArgs
): Promise<number> => {
  const database = await createDatabaseConnection();
  const adapter = database.adapter;

  try {
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
      const target = getCliRollbackTarget(parsedArgs);
      if (parsedArgs.dryRun) {
        logger.info("Planning down migrations", { target });
        const plan = await createDownPlan(adapter, migrationsPath, target);

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

      logger.info("Running down migrations", { target });
      const downResult = await runDown(adapter, migrationsPath, target);
      if (parsedArgs.json) {
        writeJson(createSuccessPayload("down", downResult));
      } else {
        printDownResult(downResult);
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
    await database.cleanup();
  }
};

const printInitNextSteps = () => {
  console.log("\nNext steps:");
  console.log("  1. Add an .up.sql and .down.sql migration pair");
  console.log("  2. Run tusk doctor");
  console.log("  3. Run tusk up");
};

const runInitCommand = async (
  parsedArgs: ParsedCommandArgs
): Promise<number> => {
  if (!parsedArgs.initFromDb) {
    logger.info("Initialising Tusk project", { migrationsPath });
    const result = await initializeProject(migrationsPath);

    if (parsedArgs.json) {
      writeJson(createSuccessPayload("init", result));
    } else {
      const message = result.created
        ? `Created migrations directory: ${migrationsPath}`
        : `Migrations directory already exists: ${migrationsPath}`;
      console.log(`✓ ${message}`);
      printInitNextSteps();
    }

    return 0;
  }

  logger.info("Generating initial migration from database");
  const database = await createDatabaseConnection();
  const adapter = database.adapter;

  try {
    const initResult = await createInitialMigration(adapter, migrationsPath);
    if (parsedArgs.json) {
      writeJson(createSuccessPayload("init", {
        upFile: initResult.upFile,
        downFile: initResult.downFile,
        tableCount: initResult.tableCount,
        checksum: initResult.checksum,
        markedAsExecuted: initResult.markedAsExecuted,
        migrationsPath,
        fromDb: true,
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
  } finally {
    await database.cleanup();
  }
};

const migrationsPath = process.env.MIGRATIONS_PATH || "./migrations";
const command = process.argv[2];
const rawArgs = process.argv.slice(3);
const rawJsonRequested = rawArgs.includes("--json");

if (rawJsonRequested) {
  process.env.LOG_LEVEL = "error";
}

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

    validateCommand(command, parsedArgs);
    logger.info("Starting tusk migration tool", {
      command,
      arg: parsedArgs.createName ?? parsedArgs.downCount,
      rawArgs,
      migrationsPath
    });

    if (command === "create") {
      logger.info("Creating migration", { name: parsedArgs.createName });
      const files = await createMigrationFile(migrationsPath, parsedArgs.createName!);
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
        const database = await createDatabaseConnection();

        try {
          const result = await validateMigrations(migrationsPath, {
            adapter: database.adapter,
            checkDatabase: true,
          });

          if (parsedArgs.json) {
            writeJson({ command: "validate", ...result });
          } else {
            printValidation(result);
          }

          process.exit(result.ok ? 0 : 1);
        } finally {
          await database.cleanup();
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

    if (command === "doctor") {
      const doctorDatabase = await createDoctorDatabaseInput();

      try {
        const report = await runDoctor({
          migrationsPath,
          tuskVersion: await getVersion(),
          database: doctorDatabase.database,
        });

        if (parsedArgs.json) {
          writeJson({ command: "doctor", ...report });
        } else {
          printDoctor(report);
        }

        process.exit(report.result === "pass" ? 0 : 1);
      } finally {
        await doctorDatabase.cleanup();
      }
    }

    if (command === "init") {
      const exitCode = await runInitCommand(parsedArgs);
      logger.info("Migration tool completed successfully");
      process.exit(exitCode);
    }

    if (command === "up" || command === "down" || command === "status") {
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
      console.error(isDriverNotFoundError(error) ? error.message : formatTuskError(error));
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
