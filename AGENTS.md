# Agent Guide

This file is the working contract for agents modifying this repository.

## Project Map

- `cli.ts` contains the Tusk command-line entrypoint.
- `index.ts` exports the public package API.
- `core/` contains migration creation, reading, execution, rollback planning, validation, and state tracking.
- `adapters/` contains database adapters. PostgreSQL support is split between `adapters/pg.ts`, `adapters/postgresjs.ts`, and `adapters/pg/*`.
- `plugins/` contains framework integrations.
- `types/` contains exported TypeScript contracts.
- `utils/` contains shared runtime, logging, checksum, filename, error, and test helpers.
- `docs/` contains user-facing guides.
- `fixtures/` contains test data. Do not put demo migrations in the root `migrations/` path.

## Commands

Use Bun for local development.

```bash
bun install
bun run build
bun run test
```

Fast checks that do not require PostgreSQL:

```bash
bun run build
bun run test
```

Database-backed checks require Docker Compose:

```bash
docker compose up -d db
bun run test:smoke
bun run test:db
```

Full local verification:

```bash
docker compose up -d db
bun run test:ci
bun run test:smoke
bun run test:db
```

## Database Defaults

The local Docker database listens on `127.0.0.1:5433`.

```bash
DATABASE_URL=postgresql://user:password@127.0.0.1:5433/migrate_tool_test
```

Never run Tusk commands against production or shared external databases unless the user explicitly provides that target for the current task.

## Editing Rules

- Keep changes small and behavior-focused.
- Prefer core helpers over duplicating CLI logic.
- Add or update tests for CLI behavior, migration planning, validation, adapters, and public API changes.
- Preserve machine-readable CLI contracts once introduced.
- Avoid new dependencies unless the user explicitly asks for them.
- Do not commit generated `dist/`, temporary package tarballs, `.tmp/`, or local environment files.

## Completion Checklist

Before reporting completion, run the narrowest meaningful check and state what passed.

- Documentation-only changes: inspect links and affected examples.
- Core or CLI changes: `bun run build` and `bun run test`.
- Database behavior changes: also run `docker compose up -d db`, `bun run test:smoke`, and `bun run test:db` when Docker is available.
