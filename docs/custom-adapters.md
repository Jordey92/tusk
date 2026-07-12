# Custom Migration Adapters

Most projects should use `@bydey/tusk/pg` or `@bydey/tusk/postgres`. A custom
client only needs the driver-neutral `MigrationAdapter` contract to use
`runUp`, `runDown`, migration plans, status, and validation.

```ts
import type {
  MigrationAdapter,
  QueryParam,
  QueryResult,
  QueryResultRow,
  TransactionClient,
} from "@bydey/tusk";
```

The implementation contract is:

- `query` executes PostgreSQL SQL with `$1` positional parameters and returns
  `{ rows, rowCount }`.
- `transaction` gives the callback one connection, commits only when it
  resolves, rolls back when it rejects, and returns the callback result.
- `acquireMigrationLock` takes an exclusive PostgreSQL session advisory lock,
  keeps that same session reserved, and rejects if another runner owns the lock
  or the adapter already has an active migration operation.
- queries and transactions issued while locked must use the lock-owning
  session. A pool with one available connection must not deadlock.
- `releaseMigrationLock` unlocks and releases that session. If releasing fails,
  reject so the caller can report the unsafe state.

Do not use transaction-scoped advisory locks: Tusk performs validation and
planning before opening each per-migration transaction, so the lock must span
the complete operation.

`createInitialMigration` additionally needs schema introspection and SQL
generation. Implement the larger `DatabaseAdapter` contract only if custom
clients must support existing-database baseline generation.

Before shipping a custom adapter, exercise at least these cases against a real
PostgreSQL instance:

1. successful apply and rollback
2. SQL failure rolls back without recording metadata
3. two runners cannot migrate concurrently
4. a one-connection pool completes without deadlocking
5. lock release happens after success and failure
6. statement timeout behavior is explicit and documented
