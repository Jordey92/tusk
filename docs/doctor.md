# Tusk Doctor

`tusk doctor` is a read-only health check for a Tusk project and PostgreSQL
target. It answers a practical question before a human, script, or AI agent
tries to migrate anything: can Tusk safely understand this project and talk to
this database?

## Why It Exists

Migration failures are easier to fix before a mutating command runs. Doctor
groups the important preflight checks into one command so you can see the
project state, database state, and compatibility concerns in one place.

It is especially useful for:

- checking a new project setup before the first `tusk up`
- checking an adopted database before continuing with new migrations
- giving AI agents a single machine-readable preflight command
- catching PostgreSQL-like targets that are not safe Tusk targets

## How To Run It

Human-readable output:

```bash
tusk doctor
```

Machine-readable output:

```bash
tusk doctor --json
```

Doctor uses the same environment variables as the rest of the CLI:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/app
MIGRATIONS_PATH=./migrations
```

or the individual database variables:

```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=app
DB_USER=postgres
DB_PASSWORD=secret
```

The command exits with:

- `0` when no checks failed
- `1` when one or more checks failed

Warnings do not fail the command. They mean Tusk can keep inspecting the
project, but there is something worth reviewing before a mutating command.

## What It Checks

`tusk.version`
: Confirms the running Tusk version can be resolved.

`migrations.path`
: Confirms the migration directory exists. If it is missing, run `tusk init`
to create the local project structure.

`migrations.valid`
: Runs the normal migration file validator when the migration directory exists.
This checks filenames, up/down pairs, duplicate timestamps, SQL content, and
transaction-control statements. An empty directory is reported clearly as a
warning so new projects know to add their first `.up.sql` / `.down.sql` pair.

`database.config`
: Confirms database configuration was found.

`database.connection`
: Confirms the configured database can be queried.

`database.engine`
: Detects the database engine and provider. PostgreSQL and Aurora PostgreSQL
are treated as supported PostgreSQL targets. Amazon Redshift is reported as a
failure because it is PostgreSQL-like, but not a normal PostgreSQL database for
Tusk migrations. Unknown PostgreSQL-compatible engines fail closed instead of
being treated as PostgreSQL.

`database.version`
: Confirms the PostgreSQL major version can be determined and is at or above
Tusk's supported floor.

`database.migrationTable`
: Checks whether `_migrations` is readable and has a trustworthy shape.
Missing metadata is a warning, not a failure, because the first `tusk up` can
create it when migrations are applied. An existing `_migrations` table with an
invalid shape is a failure, and doctor skips drift/status checks that depend on
trusting metadata.

`database.checksumMetadata`
: Checks whether `_migrations` has checksum metadata. Legacy tables without the
column can still be read, but checksum drift checks are limited.

`database.drift`
: Compares migration file checksums with executed migration records.

`database.status`
: Confirms Tusk can compute executed and pending migration counts.
This check is skipped when database drift already found unsafe migration state,
because local counts are not trustworthy until the drift is resolved.

`database.advisoryLock`
: Confirms the migration advisory lock can be acquired and released.

## JSON Output

`--json` is intended for scripts and AI agents. The shape is stable enough to
branch on `ok`, individual `checks[*].id`, and `checks[*].status`.

Example failing output:

```json
{
  "command": "doctor",
  "ok": false,
  "summary": {
    "passed": 3,
    "warnings": 0,
    "errors": 1,
    "skipped": 0
  },
  "environment": {
    "tuskVersion": "0.4.0",
    "migrationsPath": "./migrations",
    "databaseConfigured": false
  },
  "database": {
    "configured": false,
    "connected": false
  },
  "checks": [
    {
      "id": "database.config",
      "status": "fail",
      "message": "Database configuration was not found"
    }
  ]
}
```

Real output includes every check that ran, not only the failing check shown
above.

## Recommended Agent Loop

For automation, start with doctor before planning or applying migrations:

```bash
tusk doctor --json
tusk validate --json
tusk validate --db --json
tusk up --dry-run --json
```

Only run `tusk up`, `tusk down`, or `tusk init --from-db` after the plan has been reviewed
against the intended database.
