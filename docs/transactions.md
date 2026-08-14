# Transactions and Timeouts

Tusk holds a PostgreSQL session advisory lock while it plans and runs a
migration command. This prevents separate runners from interleaving one
migration history.

## Transaction Boundary

Each migration file gets its own transaction:

1. Begin a transaction.
2. Execute one up or down file.
3. Add or remove its `_migrations` row.
4. Commit before starting the next file.

The SQL and metadata for a failed file roll back together. Files committed
earlier in the command remain applied.

Do not put `BEGIN`, `COMMIT`, `ROLLBACK`, or `START TRANSACTION` in migration
files; `tusk validate` rejects them because Tusk owns the transaction.

Tusk also rejects operations PostgreSQL cannot run in a transaction, including
concurrent index changes, database or tablespace creation, `ALTER SYSTEM`, and
`VACUUM`. Run cluster-level maintenance through a separate operational process.

## Statement Timeout

By default, Tusk sets PostgreSQL `statement_timeout` to five minutes inside each
migration transaction:

```dotenv
TUSK_STATEMENT_TIMEOUT_MS=60000
```

A positive integer changes that per-statement limit. `0` leaves the database
setting unchanged. It does not limit the complete migration batch, planning,
connection setup, or advisory-lock acquisition.

Programmatic adapters use the equivalent option:

```ts
const adapter = createPgAdapter(pool, { statementTimeoutMs: 60_000 });
```

Use `tusk up --dry-run` before applying a batch. If a statement times out, fix
the SQL or choose a deliberate limit; do not repeatedly raise the timeout
without understanding the blocked query.

## Advisory Lock Identity

By default the CLI, MCP server, and Elysia plugin derive the advisory lock key
from the resolved migrations directory path. Apps that share one PostgreSQL
database but keep separate migration trees therefore do not block each other.

Override the key when you need a fixed value across hosts or path layouts:

```dotenv
TUSK_MIGRATION_LOCK_ID=424242
```

Programmatic adapters accept the same knobs:

```ts
const adapter = createPgAdapter(pool, {
  migrationLockSeed: "/absolute/path/to/migrations",
  // or: migrationLockId: 424242,
});
```

When neither option is set, adapters keep the historical default lock id
`123456789`.
