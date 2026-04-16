# Releasing Tusk

Tusk publishes to npm as `@bydey/tusk`.

The normal release path is the GitHub Actions workflow: choose a release type, let the workflow update `package.json`, run the build and test suite, publish to npm, and then create the git tag and GitHub release.

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

1. determines the version to publish
2. updates `package.json` when needed
3. runs `bun run build`
4. runs `bun test`
5. publishes with `npm publish --access public`
6. commits the version bump if one was made
7. creates and pushes the git tag
8. optionally creates a GitHub release

Required workflow permissions:

```yaml
permissions:
  contents: write
```

The workflow should use an `NPM_TOKEN` secret.
