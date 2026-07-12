# Agent Workflow

This guide describes the safest command sequence for AI agents and automation working with Tusk projects.

## Default Loop

1. Create a migration pair.

```bash
tusk create add_widgets --json
```

2. Edit both generated files under `MIGRATIONS_PATH`.

3. Validate the migration directory without touching the database.

```bash
tusk validate --json
```

4. Start the local PostgreSQL service when database checks are needed.

```bash
docker compose up -d db
```

5. Run a read-only doctor preflight against the project and database.

```bash
DATABASE_URL=postgresql://user:password@127.0.0.1:5433/migrate_tool_test \
  tusk doctor --json
```

6. Validate against migration state using read-only database checks.

```bash
DATABASE_URL=postgresql://user:password@127.0.0.1:5433/migrate_tool_test \
  tusk validate --db --json
```

7. Review the exact SQL plan before applying it.

```bash
tusk up --dry-run --json
```

8. Apply the migration to the local database.

```bash
tusk up --json
```

9. Confirm schema state.

```bash
tusk status --json
```

10. Run the relevant test tier.

```bash
bun run build
bun run test
```

For database behavior, also run:

```bash
bun run test:smoke
bun run test:db
```

## Safe Command Contracts

- `tusk validate` is read-only unless `--db` is provided, and even then it only queries migration state.
- `tusk doctor` is read-only and checks project setup, database configuration,
  PostgreSQL compatibility, migration metadata, checksum drift, status
  readability, and advisory lock support.
- `tusk up --dry-run` and `tusk down --dry-run` query migration state and print ordered SQL, but do not apply SQL.
- `tusk down --dry-run` plans one rollback by default. Use
  `tusk down <count> --dry-run` or `tusk down --all --dry-run` only when the
  wider rollback scope is intentional.
- `tusk down` and `tusk down 1` roll back exactly one latest applied migration.
  `tusk down <count>` rolls back newest first; if the count is larger than the
  applied migration count, Tusk rolls back all available applied migrations and
  reports the available count. Missing `.down.sql` files must fail planning
  before partial rollback.
- Adopted baselines are protected from ordinary rollback. Do not pass
  `--allow-baseline-rollback` unless the user explicitly authorizes dropping
  the represented existing schema. Use the flag first with `--dry-run`; the
  flag is required to display the protected destructive plan as well.
- `tusk status --json` is the preferred machine-readable status check.
- `--json` suppresses normal informational logs from stdout so agents can parse the response directly.

## Existing Database Takeover

Use `tusk init` for local project setup; it creates the migrations directory and does not inspect the database.

Use `tusk init --from-db --json` only when the user explicitly wants to adopt a
database whose schema already exists. It creates baseline migration files and
records `0000000000000_initial.up.sql` as already applied, so agents can
continue with the normal `create -> validate -> dry-run -> up` loop.

The generated baseline is not a complete PostgreSQL backup or schema dump. Tusk
fails closed when it detects schema features it cannot reproduce safely. Review
[Existing database adoption](existing-databases.md) for the supported boundary
and single-schema behavior.

## JSON Error Shape

Commands that receive `--json` return structured errors on stdout:

```json
{
  "ok": false,
  "command": "status",
  "error": {
    "code": "CONFIGURATION_ERROR",
    "message": "Missing required database configuration..."
  }
}
```

See [JSON output contracts](json-contracts.md) for the stable command payloads,
check-result envelopes, and compatibility rules.

## Production Safety

Agents should not run `tusk up`, `tusk down`, or `tusk init --from-db` against production or shared external databases unless the user explicitly provides that target for the current task. Prefer `doctor --json`, `validate --db --json`, `status --json`, and `up --dry-run --json` before any mutating command.

## MCP Server

Tusk also ships a lightweight stdio MCP server:

```bash
tusk-mcp
```

The MCP server requires one supported PostgreSQL driver:

```bash
bun add @bydey/tusk pg
# or
bun add @bydey/tusk postgres
```

When both are installed, Tusk uses `pg` unless `TUSK_DRIVER=postgres` selects
postgres.js explicitly. Valid values are `pg` and `postgres`.

Configure an MCP client with the project-local binary, project root as the
working directory, and the same environment used by the CLI. A common JSON
shape is:

```json
{
  "mcpServers": {
    "tusk": {
      "command": "/absolute/path/to/project/node_modules/.bin/tusk-mcp",
      "cwd": "/absolute/path/to/project",
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/app",
        "MIGRATIONS_PATH": "./migrations",
        "TUSK_DRIVER": "pg",
        "TUSK_STATEMENT_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

MCP clients use different configuration file names, but the `command`, working
directory, and environment values have the same purpose. If a client does not
support `cwd`, use an absolute `MIGRATIONS_PATH` and launch the server from the
project root. Keep credentials in the client's secret/environment facility
rather than committing them to the repository.

Available tools:

- `tusk_validate`: validate migration files, with optional read-only database checks.
- `tusk_status`: return migration status for a configured PostgreSQL database.
- `tusk_plan_up`: return the ordered up-migration dry-run plan.
- `tusk_plan_down`: return the ordered down-migration dry-run plan.
- `tusk_create_migration`: create paired migration files.

Database-aware tools read `DATABASE_URL` by default and also accept a
`databaseUrl` argument. Relative `migrationsPath` values resolve from the MCP
server's working directory. `TUSK_STATEMENT_TIMEOUT_MS` follows the same
non-negative millisecond contract as the CLI; `0` leaves PostgreSQL's existing
statement timeout unchanged.
