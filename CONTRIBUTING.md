# Contributing to Tusk

Use Bun for repository development:

```bash
bun install
bun run build
bun run test
```

## Database Tests

Start the disposable PostgreSQL 18 service:

```bash
docker compose up -d --wait db
```

It listens on `127.0.0.1:5433` using the credentials in `.env.example`.

Run database-backed checks:

```bash
bun run test:smoke
bun run test:db
```

Stop it when finished:

```bash
docker compose down
```

## Verification

Use the narrowest meaningful checks while developing. Before merging a runtime
or release change, run:

```bash
docker compose up -d --wait db
bun run test:ci
bun run test:smoke
bun run test:db
bun run quality:release
git diff --check
```

`quality:release` includes dead-code analysis, coverage and CRAP checks,
exhaustive mutation testing, and the production dependency audit.

For documentation-only changes, run `bun test scripts/documentation.test.ts`
and `bun run test:smoke:package`, then inspect the affected examples.

## Code Boundaries

- Export public APIs from `index.ts`.
- Put reusable migration behavior in `core/`, not CLI command branches.
- Keep shared parsing and serialization outside individual commands.
- Avoid new dependencies unless the change requires one.

## Pull Requests

- Keep changes small and behavior-focused.
- Add tests for public API, CLI, migration, adapter, or JSON changes.
- Describe the behavior, tests, and compatibility impact in the pull request.
- Do not commit generated `dist`, package tarballs, `.tmp`, or local environment files.
- Required CI and platform package-smoke checks must pass.
- Resolve every review conversation before merging.

## Releases

Releases are created only through GitHub Actions. Do not publish from a
developer machine.

1. Run `Prepare Release PR` and merge the version change after CI passes.
2. Run guarded Neon evidence against that exact commit.
3. Run guarded RDS evidence using the same candidate tarball.
4. Run `Publish npm Release` with both evidence run IDs.

The publish workflow verifies the candidate, npm provenance, deterministic
SBOM, supported runtimes, package consumers, quality gates, and hosted evidence
before creating the tag and GitHub release. Interrupted releases are recovered
by rerunning the same workflow with the same evidence IDs.

The protected `release-preparation` and `npm-release` environments must remain
restricted to `main`. npm trusted publishing is bound to
`.github/workflows/publish-npm-package.yml` and the `npm-release` environment.
