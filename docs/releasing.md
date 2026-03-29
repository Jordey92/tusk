# Releasing Tusk

Tusk currently publishes to GitHub Packages as `@jordey92/tusk`.

## Prerequisites

- GitHub repository: `jordey92/tusk`
- Package version updated in `package.json`
- A Git tag matching the version, for example `v0.3.0`
- A GitHub token with package publish permissions for manual local publishes

## Manual Local Publish

From the repo root:

```bash
bun install
bun run build
bun test
npm publish
```

`package.json` already points publishing at:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com"
}
```

For local publishing, authenticate with GitHub Packages first:

```ini
@jordey92:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## GitHub Actions Publish

This repo includes [publish-github-package.yml](../.github/workflows/publish-github-package.yml).

It publishes when:

- a tag matching `v*.*.*` is pushed
- the workflow is triggered manually with `workflow_dispatch`

The workflow:

1. installs dependencies with Bun
2. runs `bun run build`
3. runs `bun test`
4. publishes with `npm publish`

Required workflow permissions:

```yaml
permissions:
  contents: read
  packages: write
```

## Consumer Setup

Consumers installing from GitHub Packages need:

```ini
@jordey92:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

And in GitHub Actions:

```yaml
permissions:
  contents: read
  packages: read
```

## Future Scope Rename

If the package later moves to `@bydey/tusk`, these fields and docs will need updating:

- `package.json` package `name`
- `publishConfig`
- install snippets in `README.md`
- integration examples in `docs/integrations.md`
