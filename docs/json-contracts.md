# JSON Output Contracts

`--json` provides stable output for scripts, CI, MCP clients, and agents.
Human-readable output is not part of this contract.

Supported commands are `create`, `init`, `up`, `down`, `status`, `validate`, and
`doctor`, including their documented dry-run, database-check, count, and
`--all` variants.

## Common Envelope

Every payload includes:

```json
{
  "ok": true,
  "command": "status"
}
```

The exported command discriminator is one of:

```text
create | init | up | down | status | validate | doctor | version | help
```

`version` and `help` are part of the CLI envelope type but do not return JSON
data payloads.

For mutating and status commands, `ok: true` means the command completed. For
checks, `ok: false` can be an expected result: validation found errors or doctor
found a failing check. Expected check results do not include an `error` object,
and the process exits with status 1.

Unexpected failures and setup errors use:

```json
{
  "ok": false,
  "command": "down",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Rollback count must be a positive integer",
    "context": { "count": 0 }
  }
}
```

Stable error fields are `ok`, `command`, `error.code`, and `error.message`, plus
`error.cause` and `error.context` when present. Context keys are stable only
when documented for a specific command or error code.

## Command Payloads

### `create`

Stable fields: `ok`, `command`, `upFile`, `downFile`, and `migrationsPath`.

### `init`

Plain `init` returns `ok`, `command`, `migrationsPath`, `absolutePath`, and
`created`.

`init --from-db` returns `ok`, `command`, `upFile`, `downFile`, `tableCount`,
`checksum`, `markedAsExecuted`, `migrationsPath`, and `fromDb`.

### Applied `up` and `down`

Both return `ok`, `command`, `executed`, and `pending`. `down` also returns a
`rollbackTarget` whose `mode` is the stable discriminator:

```json
{
  "rollbackTarget": {
    "mode": "count",
    "requestedCount": 2,
    "availableRollbackCount": 1
  }
}
```

For `--all`, `mode` is `"all"` and `requestedCount` is omitted.

### Dry-run plans

Up and down dry runs return `ok`, `command`, `dryRun`, `direction`,
`migrations`, and `summary`.

Each migration includes `filename`, `timestamp`, `direction`, and `sql`. Up
entries include `checksum`; down entries include `rollbackOf`. Down summaries
include the same `rollbackTarget` used by applied rollback commands.

### `status`

Stable fields are `ok`, `command`, `executed`, `pending`, `summary.executed`,
and `summary.pending`. Executed entries include `filename` and `executedAt`;
pending entries include `filename`.

### `validate`

Stable fields are `ok`, `command`, `issues`, `summary.errors`,
`summary.warnings`, `summary.files`, `summary.up`, and `summary.down`.

Each issue includes `severity`, `code`, `message`, `filename`, and `context`.

### `doctor`

Stable fields are `ok`, `command`, `result`, `summary`, `environment`,
`database`, and `checks`.

Check statuses are:

```text
pass | warn | fail | skip
```

Stable check IDs are:

- `tusk.version`
- `migrations.path`
- `migrations.valid`
- `database.driver`
- `database.config`
- `database.connection`
- `database.engine`
- `database.version`
- `database.migrationTable`
- `database.checksumMetadata`
- `database.drift`
- `database.status`
- `database.advisoryLock`

## Compatibility Rules

Removing or renaming a documented field, enum value, or check ID; changing the
meaning of `ok`; changing the error envelope; or changing documented JSON exit
semantics requires a new major version.

Adding fields, check IDs, or context keys is non-breaking. Consumers must ignore
unknown fields and branch only on documented discriminators such as `command`,
`ok`, `result`, `status`, `state`, and `rollbackTarget.mode`.
