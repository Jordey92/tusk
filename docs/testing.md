# Testing Tusk

This guide covers the supported verification path for Tusk.

Tusk does not maintain a broad compatibility matrix. The supported path is the current build, test suite, package smoke test, and local Postgres-backed integration tests.

## Prerequisites

- Bun
- Docker and Docker Compose for database-backed tests

## Standard Verification

Run the full suite from the repository root:

```bash
bun run build
bun test
```

## Database-Backed Checks

Start the local PostgreSQL service used by the integration tests:

```bash
docker compose up -d db
```

Then run the suite again:

```bash
bun test
```

The integration tests expect the local service on `127.0.0.1:5433` with the credentials in [.env.example](../.env.example).

## Package Smoke Test

To verify the published shape, build the package and run the package smoke test:

```bash
bun run build
bun test package-smoke.test.ts
```

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
