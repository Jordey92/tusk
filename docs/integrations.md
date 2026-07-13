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

Elysia is the verified framework integration:

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
    }),
  )
  .listen(3000);
```

The plugin runs pending migrations before startup by default and decorates the
app with its pool and adapter. Pass an existing `pg` pool when the application
already owns one, or set `runOnStartup: false` when deployment handles
migrations separately.

## Production Rules

- Validate and inspect the dry-run plan before applying SQL.
- Verify `DATABASE_URL` identifies the intended database and use the least
  privileges that can apply the migration.
- Do not expose migration commands through a public HTTP endpoint.
- Keep the migrations directory identical across environments.
