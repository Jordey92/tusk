# Custom Migration Adapters

Use `@bydey/tusk/pg` or `@bydey/tusk/postgres` unless Tusk must support another
PostgreSQL client. That client implements `MigrationAdapter`.

```ts
import type { MigrationAdapter } from "@bydey/tusk";
```

The adapter must:

- Execute SQL with `$1` parameters and return `{ rows, rowCount }`.
- Run the transaction callback on one connection, committing on success and
  rolling back on failure.
- Acquire an exclusive session advisory lock and reserve that same connection
  for the complete migration operation.
- Route locked queries and transactions through the reserved connection,
  including when the pool has only one connection.
- Release the advisory lock and its connection, rejecting if release fails.

Do not use a transaction-scoped advisory lock. Tusk validates and plans before
opening each per-file transaction, so the lock must outlive those transactions.

`createInitialMigration` additionally needs schema introspection and SQL
generation. Implement the larger `DatabaseAdapter` only when the custom client
must support existing-database adoption.

Before shipping an adapter, test successful apply and rollback, SQL rollback
without metadata changes, concurrent runners, a one-connection pool, lock
release after success and failure, and statement-timeout behavior against real
PostgreSQL.
