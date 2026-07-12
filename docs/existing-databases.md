# Existing Database Adoption

`tusk init --from-db` adopts an existing PostgreSQL schema without replaying its
current tables against the live database.

## What Adoption Does

The command:

1. introspects the selected schema (`public` from the CLI)
2. writes `0000000000000_initial.up.sql`
3. writes `0000000000000_initial.down.sql`
4. records the up file in `_migrations` as already applied

Future migrations then use the normal `create -> validate -> dry-run -> up`
workflow.

Test adoption against a disposable copy first and review the generated SQL.
Run it against the intended database only after taking a backup, then commit
both baseline files before creating later migrations.

## Baseline Rollback Protection

An adopted baseline is protected from ordinary rollback. If `tusk down`, a
counted rollback, or `tusk down --all` would select
`0000000000000_initial.up.sql`, Tusk refuses the entire batch before executing
any rollback SQL.

The explicit override is destructive:

```bash
tusk down --dry-run --allow-baseline-rollback
# after reviewing the complete plan:
tusk down --allow-baseline-rollback
```

The override is required for the protected dry run as well, but dry-run mode
does not apply SQL. Combine it with an intentional count or `--all`. The
generated baseline down file drops every represented table with `CASCADE`; it
can remove dependent objects and data.

Programmatic callers must make the same decision explicitly with
`{ count: 1, allowBaselineRollback: true }` or
`{ all: true, allowBaselineRollback: true }` as the rollback target.

## Introspection Boundary

The baseline generator represents ordinary tables and the supported column,
primary-key, unique, foreign-key, and index metadata Tusk can introspect. It is
not a replacement for `pg_dump`, a backup, or a complete PostgreSQL schema
model.

Before writing files or metadata, Tusk checks the selected schema and refuses
adoption when it detects unsupported features such as:

- custom types, enums, domains, or arrays
- views or materialized views
- functions, procedures, triggers, or row-level security policies
- generated columns, check or exclusion constraints
- partitioned or inherited tables
- independently managed sequences

Extension-owned objects may fall into one or more of those categories. The CLI
adopts `public`; the programmatic API can select one schema at a time. Objects
outside the selected schema are not included in that baseline.

If the compatibility check fails, keep an authoritative schema dump and use a
deliberately prepared migration history instead. Do not edit a baseline after
Tusk records it; that creates checksum drift.

## Hosted PostgreSQL

Before adoption on a hosted provider:

- confirm the target is PostgreSQL with `tusk doctor`
- confirm the account can read catalog metadata and create `_migrations`
- test the generated baseline against a disposable database
- keep provider-managed schemas and extension objects out of the application
  baseline
- use a direct or session-pooled endpoint; transaction poolers cannot preserve
  the session advisory lock used by migrations
- require `sslmode=verify-full`, a writable primary, a least-privileged role, and an independently
  provisioned guard marker before automated evidence mutates a target

For v1 release evidence, the dedicated role reads a high-entropy token from
`tusk_evidence_guard.target` but must not be able to insert, update, delete, or
truncate that table. Keep the guard schema outside `public`, which is the CLI
adoption boundary. Use Neon direct endpoints, Supabase direct or session-pooler
port 5432 endpoints, and private writer endpoints for RDS or Aurora. Never use
Neon transaction pooling or Supabase port 6543 for migrations.

Amazon Redshift is not a supported target. Unknown PostgreSQL-compatible
engines fail doctor rather than being assumed compatible.
