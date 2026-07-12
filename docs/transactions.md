# Transactions and Timeouts

Tusk runs migrations under a PostgreSQL advisory lock and records migration
state in `_migrations`.

## Transaction Boundary

Each migration file gets its own database transaction:

1. Tusk begins a transaction.
2. It applies one `.up.sql` or `.down.sql` file.
3. It writes or removes the matching `_migrations` row in the same transaction.
4. It commits that migration before starting the next one.

If a migration fails, its SQL and metadata change are rolled back together.
Earlier migrations in the same command remain committed. A batch of five files
is therefore five transactions, not one all-or-nothing transaction.

Tusk holds one advisory migration lock while it plans and executes the batch so
separate runners do not interleave migration histories. Rollback planning also
resolves every required `.down.sql` file before the first rollback transaction
starts.

Do not put `BEGIN`, `COMMIT`, `ROLLBACK`, or `START TRANSACTION` in migration
files. Tusk owns the transaction boundary, and `tusk validate` reports these
statements as errors.

Tusk also rejects PostgreSQL operations that cannot run inside a transaction,
including concurrent index creation/removal, database or tablespace creation,
`ALTER SYSTEM`, and `VACUUM`. Use ordinary transactional DDL in Tusk migrations
and perform exceptional cluster-level maintenance through a separate,
explicitly operated procedure.

## Statement Timeout

The default statement timeout is 300,000 milliseconds (five minutes) for each
migration transaction. Configure CLI and MCP runs with:

```dotenv
TUSK_STATEMENT_TIMEOUT_MS=60000
```

The value must be a non-negative integer:

- a positive value sets PostgreSQL `statement_timeout` locally for each
  migration transaction
- `0` leaves PostgreSQL's existing/default statement timeout unchanged

The timeout applies per SQL statement, not to the entire `tusk up` or
`tusk down` batch. Planning, validation, connection setup, and advisory lock
acquisition are outside this statement timeout.

Programmatic adapters accept the equivalent option:

```ts
const adapter = createPgAdapter(pool, { statementTimeoutMs: 60_000 });
// or: createPostgresJsAdapter(sql, { statementTimeoutMs: 60_000 });
```

Keep the same value across CLI, MCP, and application startup paths so behavior
does not change between environments.

When PostgreSQL cancels a timed-out statement, Tusk rolls back that migration
transaction and leaves earlier committed migrations in place. Fix the SQL or
choose a deliberate timeout, then rerun the command.

## Operational Guidance

- Use `tusk up --dry-run` to inspect the complete batch first.
- Prefer a dedicated deploy/release step instead of running migrations during
  an image or application build.
- Do not run multiple migration commands through the same adapter concurrently.
- Treat long lock waits and timeouts as operational signals; do not repeatedly
  increase the timeout without understanding the blocking query.
