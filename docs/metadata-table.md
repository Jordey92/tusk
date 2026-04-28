# Metadata Table Contract

Tusk stores migration execution state in a fixed PostgreSQL table:

```text
_migrations
```

For v0.6 and v1, this table name is not configurable. The table is part of
Tusk's compatibility contract. After v1, changing the table name, required
columns, column meanings, or checksum behavior is a breaking change.

## Schema

The v1 metadata table shape is:

```sql
CREATE TABLE _migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT NOW(),
  checksum VARCHAR(64)
);
```

Required columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `integer` | Monotonic execution record id. Tusk uses this for applied order. |
| `filename` | `character varying(255)` | The applied `.up.sql` migration filename. Must be unique. |
| `executed_at` | `timestamp without time zone` | Database-side execution timestamp. |
| `checksum` | `character varying(64)` | SHA-256 checksum of the applied migration SQL. |

Required constraints:

- `id` is the primary key.
- `filename` is unique.

Tusk treats unexpected columns, missing required columns, wrong column types, or
missing required constraints as an invalid metadata table shape.

## Ordering

Tusk stores one row for each applied `.up.sql` migration.

- Apply order is `ORDER BY id ASC`.
- Rollback order is `ORDER BY id DESC`.
- `filename` stores the `.up.sql` filename, even when planning or executing a
  rollback with the matching `.down.sql` file.

Migration filenames must follow Tusk's migration filename format:

```text
<timestamp>_<name>.up.sql
<timestamp>_<name>.down.sql
```

The timestamp controls file ordering on disk. The metadata `id` controls the
actual order in which migrations were applied to the database.

## Checksums

Newly applied migrations always write a checksum. The checksum is calculated
from the `.up.sql` file contents at apply time.

Tusk uses checksums to detect unsafe drift:

- If an applied `.up.sql` file changes after it was applied, `doctor` reports
  checksum drift and `up` refuses to continue.
- If an applied `.up.sql` file is missing from disk, `doctor` reports the
  missing file and `up` refuses to continue.
- A migration file that exists on disk but not in `_migrations` is normal. It
  is pending and can be applied by `tusk up`.

## Rollback Safety

Rollback uses `.down.sql` files only. The metadata table records applied
`.up.sql` filenames, and Tusk resolves each required rollback file from the
matching `.down.sql` filename.

If a required `.down.sql` file is missing, rollback planning fails before any
partial rollback is executed.

An applied `.up.sql` file may be missing on disk during rollback only if the
required `.down.sql` file exists and `_migrations` has a valid shape. Rollback
does not need the original `.up.sql` contents to execute the `.down.sql` file.

## Legacy Checksum Rows

Tusk intentionally supports old rows where `checksum IS NULL`. These rows are
legacy-compatible, but checksum drift cannot be checked for those specific
records.

The v1 schema still requires the `checksum` column. Older metadata tables that
do not have the column are treated as legacy metadata:

- read-only checks can still read them and report limited checksum metadata
- mutating commands upgrade the table by adding `checksum VARCHAR(64)` before
  proceeding
- new rows must include checksums

This compatibility path is intentionally narrow. Tusk does not broaden legacy
support to arbitrary metadata table shapes.

## Invalid Metadata Shape

If `_migrations` exists but does not match the expected shape, Tusk fails
closed:

- `doctor` reports `database.migrationTable` as a failure
- `up` fails before applying migrations
- `down` fails before rollback planning

When the table shape is invalid, Tusk does not continue with checksum drift or
status checks that depend on trusting metadata.

## Do Not Edit Manually

Users should not manually edit `_migrations`.

Manual edits can make migration state ambiguous, especially changes to:

- `id`
- `filename`
- `checksum`
- required constraints
- required column types

If migration metadata is damaged, fix it deliberately with a database backup and
a clear repair plan. Do not edit checksums to silence drift unless you have
verified the migration file and database state are intentionally equivalent.

