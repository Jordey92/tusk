# v1 Release Checklist

Copy this file into the v1 release pull request and attach links to CI runs and
manual evidence. Do not mark an item complete from memory.

## Package and API

- [ ] Supported root and subpath imports pass in isolated consumer projects.
- [ ] `pg`-only and postgres.js-only installs pass runtime and TypeScript smoke tests.
- [ ] ESM support and package entrypoints match the compatibility policy.
- [ ] The packed tarball contains only intended runtime files and documentation.
- [ ] Public exports have been reviewed as long-term v1 commitments.

## Behavior and Safety

- [ ] Build, unit, smoke, database, dead-code, CRAP, and mutation gates pass.
- [ ] `up`, `down`, dry-run, validation, doctor, status, and JSON contracts pass.
- [ ] Missing rollback files fail before any rollback in the selected batch.
- [ ] Adopted baselines refuse ordinary rollback and require the explicit override.
- [ ] Migration-name containment and overwrite regressions pass.
- [ ] Concurrent migration-runner behavior has a passing regression test.

## Compatibility Matrix

Record the date, exact version, provider, region if relevant, and evidence link.

| Target                               | Version/provider                 | Result | Evidence |
| ------------------------------------ | -------------------------------- | ------ | -------- |
| Node.js minimum + PostgreSQL minimum | Node 18 / PostgreSQL 13          | [ ]    |          |
| Recommended local lane               | Node 24 / PostgreSQL 18          | [ ]    |          |
| Bun lane                             | Bun version / PostgreSQL version | [ ]    |          |
| Supabase or Neon                     |                                  | [ ]    |          |
| AWS RDS PostgreSQL                   |                                  | [ ]    |          |
| Aurora PostgreSQL, if available      |                                  | [ ]    |          |

For each database target, record `doctor`, `validate --db`, up/down dry runs,
apply, status, rollback, and existing-database adoption where safe.

Use the manual `Hosted Provider Evidence` workflow for hosted rows. Each target
has a protected environment named `hosted-pg-<provider>` with
`HOSTED_DATABASE_URL` and `HOSTED_GUARD_TOKEN` secrets plus the expected
database, hostname suffix, doctor provider, region, and target-label variables.
Type `RUN DISPOSABLE <provider>` to authorize a run.

The first public-provider run builds the immutable candidate. Pass that run ID
to the RDS and optional Aurora runs so every provider tests the same tarball.
The harness refuses local, unencrypted, over-privileged, replica, transaction-
pooled, non-empty, unguarded, or previously managed targets. It uses an
isolated schema for the normal lifecycle, exercises adoption only after proving
`public` is empty, verifies baseline rollback protection and session locks,
cleans only run-owned objects, and uploads allowlisted JSON evidence.

Supply the successful public-provider and RDS run IDs (and Aurora when
available) to `Publish npm Release`. Publication rejects evidence from another
commit, a local override, a different tarball, failed cleanup, or an expiring
workflow type other than `Hosted Provider Evidence`. The JSON evidence is
attached to the durable GitHub release.

## Documentation and Release

- [ ] README Quick Start succeeds from a clean project.
- [ ] Framework and MCP examples have been tested or are labelled as patterns.
- [ ] Compatibility, transaction, timeout, metadata, and adoption docs match runtime.
- [ ] v1 release notes explain breaking changes from the latest v0.x release.
- [ ] Required branch checks and conversation resolution are enabled.
- [ ] The publish workflow uses the intended npm identity and provenance settings.
- [ ] The published npm artifact and git tag report version `1.0.0`.
