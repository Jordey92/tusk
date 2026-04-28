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
- `tusk status --json` is the preferred machine-readable status check.
- `--json` suppresses normal informational logs from stdout so agents can parse the response directly.

## Existing Database Takeover

Use `tusk init --json` only when the user explicitly wants to adopt a database whose schema already exists. It creates the baseline migration files and records `0000000000000_initial.up.sql` as already applied, so agents can continue with the normal `create -> validate -> dry-run -> up` loop for future schema changes.

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

## Production Safety

Agents should not run `tusk up`, `tusk down`, or `tusk init` against production or shared external databases unless the user explicitly provides that target for the current task. Prefer `doctor --json`, `validate --db --json`, `status --json`, and `up --dry-run --json` before any mutating command.

## MCP Server

Tusk also ships a lightweight stdio MCP server:

```bash
tusk-mcp
```

Available tools:

- `tusk_validate`: validate migration files, with optional read-only database checks.
- `tusk_status`: return migration status for a configured PostgreSQL database.
- `tusk_plan_up`: return the ordered up-migration dry-run plan.
- `tusk_plan_down`: return the ordered down-migration dry-run plan.
- `tusk_create_migration`: create paired migration files.

Database-aware tools read `DATABASE_URL` by default and also accept a `databaseUrl` argument.
