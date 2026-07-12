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

### Dead-code analysis

Run the repeatable dead-code check:

```bash
bun run quality:dead-code
```

This uses `knip.json` to analyze the package entry point, CLI, MCP server,
quality scripts, and test files. The config intentionally includes bins, tests,
and script entry points so dead-code findings are useful instead of reporting
expected project surfaces as false positives.

The broader agentic quality gate also includes this check:

```bash
bun run quality:agentic
```

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

If `TUSK_SMOKE_DATABASE_URL` is set, the smoke test creates a disposable
database from that connection and exercises the packed CLI through the real
new-project flow: `init`, `doctor`, `create`, `validate`, `validate --db`,
`up --dry-run`, `up`, `status`, `down --dry-run`, and `down`.

The same smoke test also creates a second project and verifies existing
database adoption with `init --from-db`, followed by a post-baseline migration.

## Hosted Provider Evidence

Use the manual `Hosted Provider Evidence` workflow for v1 compatibility proof
against Neon, Supabase, RDS PostgreSQL, or Aurora PostgreSQL. Configure one
protected environment per provider (`hosted-pg-neon`, `hosted-pg-supabase`,
`hosted-pg-rds`, and `hosted-pg-aurora`) with these values:

- secrets: `HOSTED_DATABASE_URL`, `HOSTED_GUARD_TOKEN`
- variables: `EXPECTED_DATABASE`, `EXPECTED_HOST_SUFFIX`,
  `EXPECTED_DOCTOR_PROVIDER`, `PROVIDER_REGION`, `TARGET_LABEL`

Restrict each environment to the `main` branch and require deployment approval.
For a solo-owned repository the owner can approve; add an independent reviewer
and enable prevention of self-review when another maintainer is available.

Provision the disposable role and guard as an administrator, replacing the
placeholders with a generated 32+-character token and the role used by
`HOSTED_DATABASE_URL`:

```sql
ALTER ROLE tusk_evidence_role
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT, CREATE ON DATABASE disposable_database TO tusk_evidence_role;
GRANT USAGE, CREATE ON SCHEMA public TO tusk_evidence_role;

CREATE SCHEMA tusk_evidence_guard;
CREATE TABLE tusk_evidence_guard.target (
  guard_token text PRIMARY KEY
);
INSERT INTO tusk_evidence_guard.target (guard_token)
VALUES ('replace-with-a-high-entropy-token');
REVOKE ALL ON SCHEMA tusk_evidence_guard FROM PUBLIC;
REVOKE ALL ON TABLE tusk_evidence_guard.target FROM PUBLIC;
GRANT USAGE ON SCHEMA tusk_evidence_guard TO tusk_evidence_role;
GRANT SELECT ON TABLE tusk_evidence_guard.target TO tusk_evidence_role;
```

Store the same token as `HOSTED_GUARD_TOKEN`. The verifier confirms the role
can select the marker but cannot change it, and refuses any pre-existing object
owned by `public` before authorizing cleanup.

The target role must be least-privileged and read, but not modify, the matching
token in `tusk_evidence_guard.target`. The URL must identify that dedicated,
empty, disposable database and use `sslmode=verify-full` so both its certificate
and hostname are verified. Neon requires its direct URL;
Supabase requires direct port 5432 or the session-pooler port 5432. RDS and
Aurora run on a private ephemeral Linux runner labelled
`tusk-hosted-postgres`. The runner image must provide Bash 4+, GitHub CLI,
`jq`, `git`, GNU `find`, `realpath`, `sha256sum`, `awk`, and `tar`; the workflow
installs pinned Node/npm and Bun versions. Install the RDS CA bundle on the
runner and include its percent-encoded `sslrootcert` path in the guarded URL.

The workflow installs and exercises an exact packed tarball through doctor,
database validation, up/down plans, apply, status, rollback, adoption, and
baseline protection. It also proves advisory-lock exclusion and release on two
fixed sessions. The normal lifecycle runs in a randomized schema; adoption uses
`public` only after the guard proves it empty. A redacted JSON result is
uploaded, and publication requires successful cleanup plus matching evidence
and tarball checksums. Pass the first successful evidence run ID into later
provider runs to reuse the exact candidate.

`TUSK_HOSTED_ALLOW_LOCAL_FOR_TESTS=1` exists only to regression-test the harness
against local Docker. Evidence carrying `target.localTestOverride: true` does
not qualify for publication.

## CI Coverage

Tusk currently uses six user-facing GitHub Actions workflows plus one reusable
package-smoke workflow:

- `CI`
  - `Verify (Node 24, PostgreSQL 18)` is intended to be a required branch check
  - `Minimum Support (Node 18, PostgreSQL 13)` is intended to be a required branch check
- `Compatibility Matrix`
  - scheduled and manually runnable compatibility smoke coverage across multiple Node.js and PostgreSQL versions
- `Package Platform Compatibility`
  - verifies the installed package, CLI binaries, runtime imports, and TypeScript exports on macOS and Windows
- `Prepare Release PR`
  - manually creates a version-bump PR against `main`
- `Publish npm Release`
  - manually publishes the version already merged to `main`
- `Hosted Provider Evidence`
  - manually verifies a protected disposable hosted database and uploads redacted evidence
- `Reusable Package Smoke`
  - shared implementation used by minimum-support CI and release verification

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
