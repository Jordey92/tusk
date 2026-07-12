# Releasing Tusk

Tusk publishes to npm as `@bydey/tusk`.

The normal release path is a five-step release PR flow:

1. prepare a release pull request from the Actions tab
2. merge that PR after CI passes
3. run Neon or Supabase evidence against that exact merged version commit
4. run RDS evidence while reusing the public-provider candidate tarball
5. publish the merged version with both successful evidence run IDs

## Prerequisites

- GitHub repository: `Jordey92/tusk`
- npm trusted publishing configured for `.github/workflows/publish-npm-package.yml`
- protected `release-preparation` and `npm-release` environments restricted to `main`
- disposable Neon or Supabase and RDS targets ready for same-commit hosted
  evidence; run the evidence only after the versioned release PR is merged,
  reusing one immutable candidate tarball; Aurora evidence is attached when available

## Release Notes

The publish workflow always creates a GitHub release using GitHub-generated
release notes and attaches the checksum, SBOM, and redacted hosted evidence.

When a release deserves a fuller write-up, add a checked-in note at
`docs/releases/vX.Y.Z.md`. Agents working on a release can write this as part of
the release PR; the durable GitHub release and evidence attachment remain a
mandatory part of publication.

Good release notes should explain what changed, why it matters, and any upgrade or compatibility notes.

See [v0.5.0](./releases/v0.5.0.md) for the current release-note style.

## Release Recovery

Do not publish v1 from a developer machine. Local publication bypasses the
protected environment, hosted-provider evidence, immutable-candidate identity,
provenance, and durable release artifacts. If a publish job is interrupted,
rerun `Publish npm Release` with the same evidence run IDs. Recovery proceeds
only when an existing npm version has both the expected `gitHead` and the exact
SHA-512 integrity of the hosted-tested tarball, plus npm SLSA v1 provenance.

## Prepare Release PR

This repo includes [prepare-release-pr.yml](../.github/workflows/prepare-release-pr.yml).

It is triggered manually with `workflow_dispatch`.

Inputs:

- `release_type`: `patch`, `minor`, `major`, or `custom`
- `custom_version`: required when `release_type` is `custom`

The workflow:

1. computes the next version
2. creates a `release/vX.Y.Z` branch from `main`
3. commits synchronized versions in `package.json` and the runnable example
4. opens a pull request back to `main`

Workflow permissions:

```yaml
permissions:
  actions: write
  contents: write
  pull-requests: write
```

The prepare job is bound to the protected `release-preparation` environment.
Restrict that environment to `main` and require owner approval so a modified
workflow on another branch cannot receive write permissions. It uses the
short-lived `GITHUB_TOKEN`; because pull requests created by that token do not
trigger new workflow runs, the final step explicitly dispatches `CI` and
`Package Platform Compatibility` on the release branch. No long-lived release
token is required. See [GitHub's `GITHUB_TOKEN` documentation](https://docs.github.com/actions/concepts/security/github_token).
The repository Actions setting that allows GitHub Actions to create pull
requests must remain enabled; the environment and `main` branch policy contain
that write capability.

## Publish npm Release

This repo includes [publish-npm-package.yml](../.github/workflows/publish-npm-package.yml).

It is also triggered manually with `workflow_dispatch`.

Inputs:

- `public_evidence_run_id`: successful Neon or Supabase evidence run
- `rds_evidence_run_id`: successful RDS run that reused the same candidate
- `aurora_evidence_run_id`: optional successful Aurora run using that candidate

The workflow:

1. validates same-SHA public-provider and RDS evidence, matching cleanup, TLS,
   session-lock, adoption, and immutable-tarball checks (plus Aurora when supplied)
2. runs the `Minimum Support Verification (Node 18, PostgreSQL 13)` job
3. runs the packed-package smoke suite on current macOS and Windows runners
4. reads the version directly from `package.json` on `main`
5. verifies that an existing matching tag or npm version came from this exact commit, so interrupted releases can resume safely
6. runs `bun run test:ci` on the modern verification lane (`Node 24`, `PostgreSQL 18`)
7. runs the dead-code, coverage/CRAP, mutation, and production dependency audit gates
8. downloads and verifies the exact tarball already exercised by every hosted provider
9. smoke-tests that artifact and generates a CycloneDX SBOM from its extracted contents
10. publishes that exact tarball with npm trusted provenance; prereleases use the `next` tag and stable releases use `latest`
11. creates and pushes the git tag
12. creates a stable or prerelease GitHub release and attaches the SBOM, checksum, and hosted evidence

The publish job authenticates through npm trusted publishing and does not use a
long-lived npm token. Configure the npm package to trust
`publish-npm-package.yml` before running the first v1 release.

With Node.js 24 and npm 12, the terminal command is:

```bash
npm trust github @bydey/tusk \
  --file publish-npm-package.yml \
  --repo Jordey92/tusk \
  --environment npm-release \
  --allow-publish \
  --yes
```

The explicit permission is required by the current npm registry. Verify it with
`npm trust list @bydey/tusk`.

## Branch Protection

For the release workflow to mean anything, the default branch should require the `CI` workflow checks before merge:

- `Verify (Node 24, PostgreSQL 18)`
- `Minimum Support (Node 18, PostgreSQL 13)`
- `Package smoke (macos-latest)`
- `Package smoke (windows-latest)`

Recommended repository settings:

- require pull requests before merging
- require branches to be up to date before merging
- require conversation resolution before merging
- do not allow bypassing required checks

The `npm-release` environment is a separate publication boundary. Restrict it
to `main`, require owner approval (and prevent self-review once another
maintainer is available), and bind npm trusted publishing to that exact
environment name.
