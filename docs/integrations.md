# Framework and Deployment Integration

Prefer one dedicated migration step before the new application serves traffic.
Do not run migrations during an application or container build.

## CLI Deploy Step

Add scripts your platform can call before startup:

```json
{
  "scripts": {
    "db:check": "tusk doctor",
    "db:plan": "tusk up --dry-run",
    "db:migrate": "npm run db:check && tusk up"
  }
}
```

Run `npm run db:plan` during review and `npm run db:migrate` from the protected
deployment job. Keep `DATABASE_URL` in the platform's secret store.

This is framework-independent because migration execution stays separate from
request handling.

## Programmatic Startup

When a dedicated deploy hook is unavailable, finish migrations before opening
the server port:

```ts
import { Pool } from "pg";
import { runUp } from "@bydey/tusk";
import { createPgAdapter } from "@bydey/tusk/pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPgAdapter(pool);

await runUp(adapter, "./migrations");

// Start the framework only after runUp resolves.
```

Reuse one pool per process and close it during application shutdown. Use
`@bydey/tusk/postgres` and `createPostgresJsAdapter` when the application uses
postgres.js.

The advisory lock prevents simultaneous migration runs, but replicas that lose
the lock fail startup. A single deploy step avoids that race and gives the
migration one observable owner.

## Elysia Plugin

Elysia is the verified framework integration. Prefer the CLI deploy step above
and disable startup migrations in production:

```bash
bun add @bydey/tusk elysia pg
```

```ts
import { Elysia } from "elysia";
import { migrate } from "@bydey/tusk/elysia";

new Elysia()
  .use(
    migrate({
      connectionString: process.env.DATABASE_URL,
      migrationsPath: "./migrations",
      runOnStartup: false,
    }),
  )
  .listen(3000);
```

`runOnStartup` still defaults to `true` for compatibility. When that default is
left implicit, the plugin logs a warning and recommends this deploy-step path.
Set `runOnStartup: true` only when a dedicated migrate job is unavailable.

Pass an existing `pg` pool or postgres.js `sql` client when the application
already owns one. The plugin decorates the app with `db.adapter` plus `db.pool`
or `db.sql`. Startup failures log a formatted `TuskError` and abort listen.

```ts
import postgres from "postgres";
import { migrate } from "@bydey/tusk/elysia";

const sql = postgres(process.env.DATABASE_URL!);

migrate({
  sql,
  migrationsPath: "./migrations",
  runOnStartup: false,
});
```

## Production Rules

- Validate and inspect the dry-run plan before applying SQL.
- Verify `DATABASE_URL` identifies the intended database and use the least
  privileges that can apply the migration.
- Do not expose migration commands through a public HTTP endpoint.
- Keep the migrations directory identical across environments.
