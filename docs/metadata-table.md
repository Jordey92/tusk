# Metadata Table Contract

Tusk records applied migrations in `_migrations`. The table name is fixed in v1
and resolves through the connection's PostgreSQL `search_path`.

## Schema

```sql
CREATE TABLE _migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT NOW(),
  checksum VARCHAR(64)
);
```

| Column | Contract |
| --- | --- |
| `id` | Database-generated integer primary key used for applied order |
| `filename` | Unique applied `.up.sql` filename |
| `executed_at` | Database-side execution timestamp with a `now()` default |
| `checksum` | SHA-256 of the applied up-file contents |

Tusk rejects unexpected or missing columns, incompatible types, missing
required defaults or auto-generation, and missing primary-key or filename
uniqueness constraints.

## Ordering and Checksums

Migration files use `<timestamp>_<name>.up.sql` and the matching `.down.sql`.
The timestamp orders files on disk; `_migrations.id` records the actual applied
order. Rollback reads rows by descending id and executes matching down files.

New migrations always store a checksum. `doctor` and mutating commands reject
an applied up file that changed or disappeared. A file present on disk but not
in `_migrations` is pending.

Rollback needs the matching down file but does not need the original up-file
contents. Tusk resolves every required down file before starting a rollback
batch.

The adopted `0000000000000_initial.up.sql` baseline cannot be selected without
the explicit baseline-rollback override described in [Existing database
adoption](./existing-databases.md).

## Legacy Metadata

Rows with `checksum IS NULL` remain readable, but Tusk cannot check drift for
those rows. A legacy table without the checksum column supports read-only
inspection; a mutating command adds `checksum VARCHAR(64)` before continuing.
New rows always include checksums.

Other table-shape differences are not treated as legacy compatibility. When
the shape is untrustworthy, doctor fails and mutating commands stop before
planning or applying SQL.

## Operational Boundary

Do not edit `_migrations` manually to silence drift. Repair damaged metadata
only with a verified database backup and a deliberate reconciliation plan.

Tusk maintains one history per resolved `_migrations` table. Applications that
need independent histories use separate databases or connections with isolated
schemas and stable `search_path` settings. Changing `search_path` between Tusk
commands in one database is unsupported.

Changing the table name, required columns, column meanings, ordering, or
checksum behavior incompatibly requires a new major version. See the
[compatibility policy](./compatibility.md).
