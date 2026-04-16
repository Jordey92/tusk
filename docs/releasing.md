# Releasing Tusk

Tusk publishes to npm as `@bydey/tusk`.

The release path is intentionally simple: build, run the test suite, tag the version, and publish the package.

## Prerequisites

- GitHub repository: `jordey92/tusk`
- Package version updated in `package.json`
- A Git tag matching the version, for example `v0.3.0`
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

## GitHub Actions Publish

This repo includes [publish-npm-package.yml](../.github/workflows/publish-npm-package.yml).

It publishes when:

- a tag matching `v*.*.*` is pushed
- the workflow is triggered manually with `workflow_dispatch`

The workflow:

1. installs dependencies with Bun
2. runs `bun run build`
3. runs `bun test`
4. publishes with `npm publish --access public`

Required workflow permissions:

```yaml
permissions:
  contents: read
```

The workflow should use an `NPM_TOKEN` secret.
