# Contributing

Tusk is a SQL-first PostgreSQL migration tool for Node.js and Bun. The project favors small, explicit changes with tests close to the affected behavior.

## Setup

```bash
bun install
bun run build
bun run test
```

For database-backed tests:

```bash
docker compose up -d --wait db
bun run test:smoke
bun run test:db
```

The local database connection string is:

```bash
postgresql://user:password@127.0.0.1:5433/migrate_tool_test
```

## Development Workflow

1. Make the smallest change that solves the problem.
2. Add focused tests for the changed behavior.
3. Run `bun run build` and `bun run test`.
4. Run the Docker-backed test scripts when the change touches database execution, adapters, CLI database behavior, package smoke behavior, or migrations.

## Test Tiers

- `bun run test`: fast unit checks without PostgreSQL.
- `bun run test:smoke`: package, CLI, and Elysia smoke checks against local PostgreSQL.
- `bun run test:db`: deeper adapter and migration engine integration checks.
- `bun run test:ci`: build plus the full Bun test suite. Use this with local PostgreSQL running when mirroring CI.

## Code Style

- Keep public API exports in `index.ts`.
- Put reusable migration behavior in `core/`, not directly in `cli.ts`.
- Put shared CLI serialization and parsing helpers outside command branches.
- Prefer structured outputs for agent and CI integrations.
- Avoid new dependencies unless they are explicitly requested.

## Pull Request Notes

Describe the behavior change, the tests run, and any compatibility risks. If a command output contract changes, call that out directly.
