# Agent and MCP Workflow

Inspect migration state before changing it, and use JSON output instead of
parsing human-readable logs.

## Safe Loop

```bash
tusk create add_widgets --json
# Edit both generated files.
tusk validate --json
tusk doctor --json
tusk validate --db --json
tusk up --dry-run --json
# Apply only after reviewing the plan and target.
tusk up --json
tusk status --json
```

`doctor`, `validate --db`, `status`, and dry-run plans query the database but do
not apply migration SQL. `create` writes local files. `up`, `down`, and
`init --from-db` mutate migration state.

`down` plans one rollback by default. Use a count or `--all` only when the wider
scope is intentional. Never pass `--allow-baseline-rollback` without explicit
authorization to drop the adopted schema represented by the baseline.

Do not run mutating commands against production or a shared external database
unless the user supplied that target for the current task. Prefer a disposable
database for testing.

See [JSON output contracts](./json-contracts.md) for stable fields, error
envelopes, and doctor check IDs.

## MCP Server

Install Tusk with one supported driver, then launch the stdio server:

```bash
tusk-mcp
```

Configure the project-local binary, project root, and database environment in
the MCP client:

```json
{
  "mcpServers": {
    "tusk": {
      "command": "/project/node_modules/.bin/tusk-mcp",
      "cwd": "/project",
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/app",
        "MIGRATIONS_PATH": "./migrations",
        "TUSK_DRIVER": "pg"
      }
    }
  }
}
```

Keep credentials in the client's secret or environment facility. If the client
cannot set `cwd`, use an absolute `MIGRATIONS_PATH` and start the server from the
project root.

Available tools:

- `tusk_validate`: validate files, optionally against database state
- `tusk_status`: read applied and pending migrations
- `tusk_plan_up`: return the ordered up plan
- `tusk_plan_down`: return the ordered rollback plan
- `tusk_create_migration`: create paired migration files

Database-aware tools use `DATABASE_URL` by default and may accept a
`databaseUrl` override. Treat that override as an explicit target selection.
Relative migration paths resolve from the MCP server's working directory.
