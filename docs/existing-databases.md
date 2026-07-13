# Existing Database Adoption

`tusk init --from-db` creates a migration baseline for a PostgreSQL schema that
already exists. It does not replay the generated SQL against that database.

The command:

1. Introspects `public`.
2. Writes `0000000000000_initial.up.sql` and its matching down file.
3. Records the up file in `_migrations` as already applied.

Future changes use the normal `create -> validate -> dry-run -> up` workflow.
Test adoption against a disposable copy, review both files, and keep a database
backup before using it on a production or shared database.

## Protected Baseline

Ordinary rollback cannot select the adopted baseline. Tusk refuses the entire
batch before running SQL unless the explicit destructive override is present:

```bash
tusk down --all --dry-run --allow-baseline-rollback
tusk down --all --allow-baseline-rollback
```

The generated down file drops represented tables with `CASCADE`; it can remove
data and dependent objects. Programmatic callers must make the same decision
with `allowBaselineRollback: true` in the rollback target.

## Supported Boundary

The baseline represents ordinary tables, columns, primary keys, unique and
foreign-key constraints, and indexes that Tusk can reproduce safely. It is not
a backup or a replacement for `pg_dump`.

Tusk refuses adoption before writing files or metadata when the selected
schema contains unsupported features, including:

- Custom types, enums, domains, or arrays
- Views, routines, triggers, or row-level security policies
- Generated columns, check constraints, or exclusion constraints
- Partitioned or inherited tables
- Independently managed sequences

The CLI adopts `public`; the programmatic API can select one schema at a time.
Objects outside the selected schema are not included. Do not edit an adopted
up file after Tusk records it, because that creates checksum drift.

## Hosted PostgreSQL

- Run `tusk doctor` first to confirm the engine and connection.
- Use a writable primary and a role that can inspect the schema and manage
  `_migrations`.
- Use a direct or session-pooled connection. Transaction poolers cannot retain
  Tusk's session advisory lock.
- Require `sslmode=verify-full` and test adoption on a disposable database.

Amazon Redshift and unknown PostgreSQL-compatible engines are not supported.
