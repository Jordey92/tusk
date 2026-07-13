# Basic Tusk Example

This example uses `pg` and one reversible migration.

```bash
bun install
cp .env.example .env
```

Point `DATABASE_URL` at a disposable PostgreSQL database, then run:

```bash
bun run db:validate
bun run db:doctor
bun run db:plan
bun run db:up
bun run db:status
```

Create another migration with `bun run db:create add_posts`. Edit both generated
files before validating them.

Preview and roll back the latest migration:

```bash
bun run db:down:plan
bun run db:down
```
