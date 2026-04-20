# Releasing Tusk

Tusk publishes to npm as `@bydey/tusk`.

The normal release path is the GitHub Actions workflow: choose a release type, let the workflow update `package.json`, verify the minimum-supported compatibility lane, run the modern build and test suite, publish to npm, and then create the git tag and GitHub release.

## Prerequisites

- GitHub repository: `jordey92/tusk`
- An npm token with publish access to the `@bydey` scope

## Manual Local Publish

From the repo root:

```bash
bun install
bun run build
bun test
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

## GitHub Actions Release

This repo includes [publish-npm-package.yml](../.github/workflows/publish-npm-package.yml).

It is triggered manually with `workflow_dispatch`.

Inputs:
- `release_type`: `as-is`, `patch`, `minor`, `major`, or `custom`
- `custom_version`: required when `release_type` is `custom`
- `create_github_release`: whether to create a GitHub release after publishing

The workflow:

1. runs the `Minimum Support Verification (Node 18, PostgreSQL 13)` job against the packed package smoke path
2. determines the version to publish
3. updates `package.json` when needed
4. runs `bun run build`
5. runs `bun test` on the modern verification lane (`Node 24`, `PostgreSQL 18`)
6. publishes with `npm publish --access public`
7. commits the version bump if one was made
8. creates and pushes the git tag
9. optionally creates a GitHub release

Required workflow permissions:

```yaml
permissions:
  contents: write
```

The workflow should use an `NPM_TOKEN` secret.

## Branch Protection

For the release workflow to mean anything, the default branch should require the `CI` workflow checks before merge:

- `Verify (Node 24, PostgreSQL 18)`
- `Minimum Support (Node 18, PostgreSQL 13)`

Recommended repository settings:

- require pull requests before merging
- require branches to be up to date before merging
- require conversation resolution before merging
- do not allow bypassing required checks
