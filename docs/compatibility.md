# Compatibility Policy

Tusk follows semantic versioning. v1 upgrades preserve documented migrations,
imports, and automation contracts.

## Supported Environments

- Node.js 18+
- Bun 1.3.8+
- PostgreSQL 13+
- ESM for programmatic imports; the CLI also works in CommonJS projects

The Elysia integration requires Node.js 20+ or Bun 1.3.8+. Elysia 1.4 projects
may need `skipLibCheck: true` because of upstream declaration errors; this does
not affect Tusk's runtime behavior.

## Package Entrypoints

- `@bydey/tusk`: driver-neutral operations and public types
- `@bydey/tusk/pg`: `pg` adapter
- `@bydey/tusk/postgres`: postgres.js adapter
- `@bydey/tusk/elysia`: Elysia plugin

Files under `dist/` and other deep imports are implementation details.

## Stable v1 Contracts

- Documented exports from supported package entrypoints
- CLI commands, options, defaults, and documented exit codes
- Fields and discriminators in [JSON output contracts](./json-contracts.md)
- `_migrations` behavior in the [metadata table contract](./metadata-table.md)
- Migration ordering, checksums, transaction boundaries, and rollback order
- One-migration default rollback and adopted-baseline protection
- Supported Node.js, Bun, and PostgreSQL minimums

Human-readable wording, whitespace, symbols, timestamps, debug logs, and
undocumented JSON context keys are not machine contracts.

## Versioning Rules

A major release is required to remove or incompatibly change a documented
export, command, option, default, exit code, JSON field, doctor check ID,
metadata meaning, migration order, transaction boundary, rollback rule, or
supported runtime minimum.

Minor and patch releases may add optional APIs, fields, checks, integrations,
or supported versions; improve human output; and fix behavior that contradicts
a documented safety contract.

Rejecting undocumented unsafe input, such as path traversal, malformed
migration names, or transaction-control statements inside managed migrations,
is a bug fix rather than a compatibility break.

JSON consumers must ignore unknown fields and branch only on documented
discriminators. When practical, deprecate a breaking contract with a documented
replacement before removing it.
