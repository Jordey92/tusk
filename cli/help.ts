const commandHelp: Record<string, string> = {
  create:
    "Usage: tusk create <name> [--json]\n\nCreate a paired timestamped .up.sql and .down.sql migration.",
  init: "Usage: tusk init [--from-db] [--json]\n\nCreate the migrations directory, or adopt a supported existing schema with --from-db.",
  up: "Usage: tusk up [--dry-run] [--json]\n\nValidate and apply all pending migrations.",
  down: "Usage: tusk down [count | --all] [--dry-run] [--json] [--allow-baseline-rollback]\n\nRoll back one migration by default. Adopted baselines require the explicit safety override.",
  status:
    "Usage: tusk status [--exit-code] [--quiet | --json]\n\nRead migration state without changing the database.",
  validate:
    "Usage: tusk validate [--db] [--json]\n\nValidate migration files and optionally compare applied database state.",
  doctor:
    "Usage: tusk doctor [--json]\n\nRun read-only project, database, compatibility, drift, and lock checks.",
  version: "Usage: tusk version\n\nPrint the installed Tusk version.",
};

export const getCommandHelp = (target: string): string | undefined =>
  commandHelp[target];

export const renderHelp = () => {
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
    --allow-baseline-rollback
                  Explicitly allow destructive adopted-baseline rollback

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
  TUSK_DRIVER     Explicit client driver: pg or postgres
  TUSK_STATEMENT_TIMEOUT_MS
                  Per-migration timeout in milliseconds (0 keeps DB default)
  TUSK_MIGRATION_LOCK_ID
                  Explicit PostgreSQL advisory lock key (default: 123456789)
  TUSK_MIGRATION_LOCK_SEED
                  Opt-in seed used to derive a lock key when TUSK_MIGRATION_LOCK_ID
                  is unset
  TUSK_SCHEMA     Schema for tusk init --from-db (default: public)

Project config (optional, cwd):
  tusk.config.json|.ts|.js|.mjs
                  migrationsPath, driver, statementTimeoutMs, schema
                  Environment variables override file values. Do not store
                  database credentials in the project config file.

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

export const showCommandHelp = (target?: string) => {
  if (!target) {
    renderHelp();
    return true;
  }

  const help = getCommandHelp(target);
  if (!help) return false;
  console.log(`\n${help}\n`);
  return true;
};

export const renderVersion = async (version: string) => {
  console.log(`tusk v${version}`);
};
