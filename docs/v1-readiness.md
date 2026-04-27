# v1.0.0 Readiness

Tusk is close to a v1 shape because the core product is intentionally small: SQL-first PostgreSQL migrations with clear CLI behavior, JSON output, and safe preflight checks.

The work before v1 should be about confidence and compatibility, not adding a large feature set.

## Release Bar

Tusk should be ready for v1 when these contracts feel stable enough to support as promises:

- CLI command semantics
- `_migrations` metadata schema and compatibility behavior
- JSON output shapes for automation and agents
- PostgreSQL support floor
- rollback and existing-database adoption behavior
- documented release and breaking-change policy

## Code Changes

### Define a compatibility policy

Add a short compatibility policy to the docs that explains what counts as a breaking change:

- changing `tusk up`, `tusk down`, `tusk init`, `tusk status`, `tusk validate`, or `tusk doctor` behavior
- changing JSON response envelopes or check IDs
- changing `_migrations` metadata in a way older installs cannot read
- changing rollback ordering or default rollback count
- raising the Node.js or PostgreSQL support floor
- changing exported TypeScript APIs

### Lock CLI contracts with tests

Add or review CLI contract tests for:

- `tusk up`
- `tusk up --dry-run`
- `tusk down`
- `tusk down <count>`
- `tusk down --all`
- `tusk down --dry-run`
- `tusk init`
- `tusk status --json`
- `tusk validate --json`
- `tusk validate --db --json`
- `tusk doctor --json`

The important part is not just coverage. The tests should make accidental contract changes obvious.

### Lock metadata compatibility

Add focused tests for `_migrations` compatibility:

- current table with checksums
- legacy table without checksums
- adopted baseline from `tusk init`
- checksum drift detection
- read-only commands against legacy metadata
- mutating commands upgrading metadata safely when needed

### Add package-level v1 smoke coverage

Extend the packed-package smoke path so it proves the npm artifact can:

- create a migration
- validate it
- run doctor
- dry-run up
- apply up
- report status
- dry-run down
- roll back one migration
- create/adopt a baseline with `init`

This is the highest-value check because users install the package, not the source tree.

### Stabilize JSON contracts

Document the JSON fields that are intended to be stable for automation:

- common `ok` and `command` fields
- structured error envelope
- status summary fields
- doctor check IDs and statuses
- dry-run plan shape
- migration create/init output shape

Anything not documented can remain implementation detail until v1.

### Add a v1 release checklist

Add a reusable release checklist that includes:

- full CI passing
- compatibility matrix passing
- CRAP analysis passing
- mutation testing passing
- dead-code analysis passing
- packed-package smoke passing
- manual hosted-PostgreSQL checks recorded
- release notes reviewed

## Manual Testing

Before v1, manually test against the database targets Tusk intends to support:

- local Docker PostgreSQL 13
- local Docker PostgreSQL 18
- Supabase or Neon PostgreSQL
- AWS RDS PostgreSQL
- Aurora PostgreSQL, if accessible

For each target, run the same scriptable flow:

```bash
tusk doctor --json
tusk create add_v1_smoke_table --json
tusk validate --json
tusk validate --db --json
tusk up --dry-run --json
tusk up --json
tusk status --json
tusk down --dry-run --json
tusk down --json
tusk status --json
```

For existing-database adoption, run:

```bash
tusk doctor --json
tusk init --json
tusk status --json
tusk up --dry-run --json
tusk create add_post_baseline_table --json
tusk validate --db --json
tusk up --json
tusk down --dry-run --json
```

Do not include Redshift in the support matrix. Doctor should keep failing Redshift clearly because Redshift is PostgreSQL-like, not normal PostgreSQL.

## Documentation

Before v1, the docs should clearly cover:

- new database setup
- existing database takeover
- rollback behavior and why `down` defaults to one migration
- custom migrations paths
- hosted PostgreSQL caveats
- `doctor`
- JSON output for agents and scripts
- MCP usage
- release and compatibility policy

## Not Required For v1

These can stay future work:

- support for non-PostgreSQL databases
- Django migration interop
- a hosted UI
- schema diffing
- a migration DSL
- more framework integrations

Keeping v1 small is the point. Tusk should be stable because it promises less and does those things well.
