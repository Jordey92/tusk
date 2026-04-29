# JSON output contracts

Tusk treats `--json` output as a public automation contract. Scripts, CI jobs,
MCP clients, and AI agents should be able to parse these payloads without
depending on human output.

Human-readable CLI output is not covered by this contract.

## Supported commands

`--json` is supported for:

- `tusk create`
- `tusk init`
- `tusk init --from-db`
- `tusk up`
- `tusk up --dry-run`
- `tusk down`
- `tusk down <count>`
- `tusk down --all`
- `tusk down --dry-run`
- `tusk status`
- `tusk validate`
- `tusk validate --db`
- `tusk doctor`

## Common envelope

Every JSON payload includes:

```json
{
  "ok": true,
  "command": "status"
}
```

For recognized commands, `command` is one of:

```text
create | init | up | down | status | validate | doctor | version | help
```

For mutating commands and status commands, `ok: true` means the command
completed successfully.

For check commands, `ok` describes the check result:

- `validate --json` returns `ok: false` when validation issues include errors.
- `doctor --json` returns `ok: false` when doctor reports a failing check.

Those are expected command results, not runtime errors. They do not include an
`error` object.

## Error envelope

Unexpected failures and command setup errors use the structured error envelope:

```json
{
  "ok": false,
  "command": "up",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Rollback count must be a positive integer",
    "context": {
      "count": 0
    }
  }
}
```

Stable fields:

- `ok`
- `command`
- `error.code`
- `error.message`
- `error.cause`
- `error.context`

`error.context` is structured diagnostic data. Individual context keys are
stable only when a command or error code documents them explicitly.

## Command payloads

### `create`

Stable fields:

- `ok`
- `command`
- `upFile`
- `downFile`
- `migrationsPath`

### `init`

Plain `tusk init --json` returns:

- `ok`
- `command`
- `migrationsPath`
- `absolutePath`
- `created`

`tusk init --from-db --json` returns:

- `ok`
- `command`
- `upFile`
- `downFile`
- `tableCount`
- `checksum`
- `markedAsExecuted`
- `migrationsPath`
- `fromDb`

### `up` and `down`

Applied migration commands return:

- `ok`
- `command`
- `executed`
- `pending`

`down` also returns `rollbackTarget`:

```json
{
  "rollbackTarget": {
    "mode": "count",
    "requestedCount": 2,
    "availableRollbackCount": 1
  }
}
```

or:

```json
{
  "rollbackTarget": {
    "mode": "all",
    "availableRollbackCount": 3
  }
}
```

`rollbackTarget.mode` is the stable discriminator. Consumers should branch on
`mode`, not on the presence of individual fields.

### Dry-run plans

`up --dry-run --json` and `down --dry-run --json` return:

- `ok`
- `command`
- `dryRun`
- `direction`
- `migrations`
- `summary`

Each migration entry includes:

- `filename`
- `timestamp`
- `direction`
- `sql`
- `checksum`, for up migrations
- `rollbackOf`, for down migrations

Down dry-run summaries include the same `rollbackTarget` shape used by
`tusk down --json`.

### `status`

Stable fields:

- `ok`
- `command`
- `executed`
- `pending`
- `summary.executed`
- `summary.pending`

Executed migration entries include:

- `filename`
- `executedAt`

Pending migration entries include:

- `filename`

### `validate`

Stable fields:

- `ok`
- `command`
- `issues`
- `summary.errors`
- `summary.warnings`
- `summary.files`
- `summary.up`
- `summary.down`

Issue entries include:

- `severity`
- `code`
- `message`
- `filename`
- `context`

### `doctor`

Stable fields:

- `ok`
- `command`
- `result`
- `summary`
- `environment`
- `database`
- `checks`

Stable doctor check statuses:

```text
pass | warn | fail | skip
```

Stable doctor check IDs:

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

## Compatibility rules

After v1, these changes are breaking:

- removing a documented field
- renaming a documented field
- changing a documented enum string
- changing the meaning of `ok`
- changing a documented doctor check ID
- changing the structured error envelope
- changing exit-code semantics for documented JSON commands

These changes are non-breaking:

- adding a new field
- adding a new doctor check ID
- adding extra `error.context` keys
- adding extra `issue.context` keys

Consumers should ignore unknown fields and branch only on documented
discriminators such as `command`, `ok`, `result`, `status`, `state`, and
`rollbackTarget.mode`.
