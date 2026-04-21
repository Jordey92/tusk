# Releasing Tusk

Tusk publishes to npm as `@bydey/tusk`.

The normal release path is a two-step release PR flow:

1. prepare a release pull request from the Actions tab
2. merge that PR after CI passes
3. publish the merged version from the Actions tab

## Prerequisites

- GitHub repository: `jordey92/tusk`
- An npm token with publish access to the `@bydey` scope
- A `RELEASE_PR_TOKEN` secret with permission to push branches and open pull requests

## Manual Local Publish

From the repo root:

```bash
bun install
bun run build
bun run test:ci
npm publish --access public
```

`package.json` already sets:

```json
"publishConfig": {
  "access": "public"
}
```

For local publishing, authenticate to npm first:

```bash
npm login
```

## Prepare Release PR

This repo includes [prepare-release-pr.yml](../.github/workflows/prepare-release-pr.yml).

It is triggered manually with `workflow_dispatch`.

Inputs:
- `release_type`: `patch`, `minor`, `major`, or `custom`
- `custom_version`: required when `release_type` is `custom`

The workflow:

1. computes the next version
2. creates a `release/vX.Y.Z` branch from `main`
3. commits the `package.json` version bump on that branch
4. opens a pull request back to `main`

Workflow permissions:

```yaml
permissions:
  contents: read
```

The workflow should use a `RELEASE_PR_TOKEN` secret instead of the default `GITHUB_TOKEN`, because PRs created with `GITHUB_TOKEN` do not trigger the normal `pull_request` CI workflows. The token itself needs permission to push branches and open pull requests. See [GitHub's `GITHUB_TOKEN` documentation](https://docs.github.com/actions/concepts/security/github_token).

## Publish npm Release

This repo includes [publish-npm-package.yml](../.github/workflows/publish-npm-package.yml).

It is also triggered manually with `workflow_dispatch`.

Inputs:
- `create_github_release`: whether to create a GitHub release after publishing

The workflow:

1. runs the `Minimum Support Verification (Node 18, PostgreSQL 13)` job against the packed package smoke path
2. reads the version directly from `package.json` on `main`
3. verifies that the matching tag and npm version do not already exist
4. runs `bun run test:ci` on the modern verification lane (`Node 24`, `PostgreSQL 18`)
5. publishes with `npm publish --access public`
6. creates and pushes the git tag
7. optionally creates a GitHub release

The publish workflow should use an `NPM_TOKEN` secret.

## Branch Protection

For the release workflow to mean anything, the default branch should require the `CI` workflow checks before merge:

- `Verify (Node 24, PostgreSQL 18)`
- `Minimum Support (Node 18, PostgreSQL 13)`

Recommended repository settings:

- require pull requests before merging
- require branches to be up to date before merging
- require conversation resolution before merging
- do not allow bypassing required checks
