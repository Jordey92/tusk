# Basic Tusk Example

This is a runnable `pg` example with one reversible migration.

From this directory:

```bash
bun install
cp .env.example .env
```

That install path is for a published Tusk version. On a release PR, the example
intentionally references the pending version, which is not in npm yet. From the
repository root, verify it through `bun run test:smoke:package`; the smoke suite
packs the checkout, installs that tarball into an isolated copy of this example,
and runs its validation command without changing the checked-in dependency.

Point `.env` at a disposable PostgreSQL database, then run the safe migration
flow:

```bash
bun run db:validate
bun run db:doctor
bun run db:plan
bun run db:up
bun run db:status
```

Create another migration with:

```bash
bun run db:create add_posts
```

Edit both generated files before validating again. To preview and roll back the
latest migration:

```bash
bun run db:down:plan
# after reviewing the plan:
bun run db:down
```

The example pins the matching Tusk release line. In an application, install the
current release directly:

```bash
bun add @bydey/tusk pg
```
