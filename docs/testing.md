# Testing Tusk

This guide covers the supported verification path for Tusk.

Tusk verifies two things continuously:

- the modern primary lane used for day-to-day development
- the oldest supported Node.js and PostgreSQL versions promised in the public docs

GitHub Actions also runs an expanded compatibility matrix on a schedule.

## Prerequisites

- Bun
- Docker and Docker Compose for database-backed tests
- Node.js if you want to run the packaged CLI smoke test with `node`

## Local Verification

### Fast unit checks

Run the tests that do not require PostgreSQL:

```bash
bun run test
# or
bun run test:unit
```

This is the recommended default local check while iterating on non-database code.

### Smoke checks

Run the highest-signal local smoke paths against a running PostgreSQL service on `127.0.0.1:5433`:

```bash
bun run test:smoke
```

This covers:

- the packed npm artifact via `package-smoke.test.ts`
- the CLI happy path via `cli.test.ts`
- the Elysia startup integration via `plugins/elysia.test.ts`

### Full modern verification

Run the same command as the modern GitHub Actions verification lane:

```bash
bun run test:ci
```

This matches the `Verify (Node 24, PostgreSQL 18)` workflow when a local PostgreSQL service is available.

### Database-backed integration coverage

Run the deeper PostgreSQL-backed integration suites:

```bash
bun run test:db
```

This covers the adapter and migration engine integration paths beyond the smoke tests.

### Minimum-supported packaged smoke test

To verify the published package shape and the oldest supported runtime/database pair:

```bash
TUSK_SMOKE_DATABASE_URL=postgresql://user:password@127.0.0.1:5433/migrate_tool_test \
  bun run test:smoke:package
```

This is the same path used by the `Minimum Support (Node 18, PostgreSQL 13)` workflow, except CI also runs the test under Node.js 18.

## Database-Backed Checks

Start the local PostgreSQL service used by the integration tests:

```bash
docker compose up -d db
```

Then run the suite again:

```bash
bun run test:smoke
bun run test:db
# or the full lane
bun run test:ci
```

The integration tests expect the local service on `127.0.0.1:5433` with the credentials in [.env.example](../.env.example).

## Package Smoke Test

To verify the packed npm artifact without hitting a database:

```bash
bun run test:smoke:package
```

If `TUSK_SMOKE_DATABASE_URL` is set, the smoke test also exercises `create`, `up`, `status`, and `down` against a real PostgreSQL instance using the packed CLI.

## CI Coverage

Tusk currently uses three GitHub Actions workflows:

- `CI`
  - `Verify (Node 24, PostgreSQL 18)` is intended to be a required branch check
  - `Minimum Support (Node 18, PostgreSQL 13)` is intended to be a required branch check
- `Compatibility Matrix`
  - scheduled and manually runnable compatibility smoke coverage across multiple Node.js and PostgreSQL versions
- `Release and Publish npm Package`
  - manual release workflow gated on the minimum-supported package smoke test and the modern full-suite verification path

## Troubleshooting

If database tests fail, confirm the container is healthy and the port is free:

```bash
docker compose ps db
lsof -i :5433
```

If you need a fresh database, remove the Docker volume and restart:

```bash
docker compose down -v
docker compose up -d db
```
