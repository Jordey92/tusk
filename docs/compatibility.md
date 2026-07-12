# Compatibility Policy

Tusk follows semantic versioning. The v1 release freezes a deliberately small
set of public contracts so projects can upgrade within v1 without rewriting
migrations or automation.

## Supported Environments

- Node.js 18 or newer
- Bun 1.3.8 or newer
- PostgreSQL 13 or newer
- ESM for the programmatic API

The CLI can be called from projects that otherwise use CommonJS. Raising a
runtime or PostgreSQL minimum is a breaking change after v1.

The Elysia 1.4 integration is runtime- and declaration-tested, but Elysia's own
published declarations do not currently pass an independent TypeScript 5.9
library check. Elysia consumers may need `skipLibCheck: true`; the other Tusk
entrypoints are smoke-tested with library checking enabled. This upstream
limitation does not affect runtime behavior.

The Elysia integration supports Bun 1.3.8+ and Node.js 20+. Core Tusk APIs,
the CLI, MCP server, and driver adapters retain the package-wide Node.js 18
floor. The Elysia framework is loaded lazily, so importing or inspecting the
optional subpath remains safe on Node.js 18.

## Public Package Entrypoints

The supported import paths are:

- `@bydey/tusk` for driver-neutral migration operations and public types
- `@bydey/tusk/pg` for the `pg` adapter
- `@bydey/tusk/postgres` for the postgres.js adapter
- `@bydey/tusk/elysia` for the Elysia integration

Files under `dist/` and any other deep import are implementation details. They
are not compatibility promises.

## Stable v1 Contracts

The following are compatibility commitments:

- documented TypeScript exports from the supported package entrypoints
- CLI command names, option meanings, defaults, and documented exit codes
- JSON fields and discriminators listed in [JSON output
  contracts](json-contracts.md)
- `_migrations` table semantics in the [metadata table
  contract](metadata-table.md)
- migration filename ordering, checksum behavior, and rollback ordering
- the default one-migration rollback scope
- adopted-baseline rollback protection
- the supported Node.js, Bun, and PostgreSQL floors

Human-readable wording, whitespace, symbols, timestamps, debug logs, and
undocumented JSON context keys are not stable machine contracts.

## Breaking Changes

After v1, these require a new major version:

- removing or renaming a documented export
- changing a documented function signature incompatibly
- removing or renaming a CLI command or option
- changing a command default, rollback scope, or documented exit code
- removing or renaming a stable JSON field, enum value, or doctor check ID
- changing `_migrations` in a way an existing v1 project cannot read safely
- changing migration order, checksum meaning, or transaction boundaries
- weakening adopted-baseline rollback protection
- raising a supported runtime or PostgreSQL floor

Safety fixes may reject inputs that were never documented as valid, including
path traversal, malformed migration names, or transaction-control statements
inside Tusk-managed migrations. Those are bug fixes, not compatibility
promises.

## Non-Breaking Changes

The following can ship in a minor or patch release when existing behavior is
preserved:

- adding an optional API, CLI flag, JSON field, or doctor check
- improving human-readable output and remediation guidance
- supporting a newer Node.js, Bun, PostgreSQL, driver, or framework version
- fixing behavior that contradicts a documented safety contract
- improving performance without changing observable results

JSON consumers must ignore unknown fields and branch only on documented
discriminators.

## Deprecation

When practical, a planned breaking change is deprecated in the latest current
major before it is removed. Release notes must identify the replacement and the
first version where removal may occur.

## Pre-v1 Releases

Versions below 1.0 may still adjust public behavior while the contract is being
finalized. Such changes must be called out in release notes and should include a
clear migration path.
