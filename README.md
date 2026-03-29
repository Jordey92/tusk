# Tusk

Simple PostgreSQL migration tool for Node.js and Bun.

## Preconditions

Tusk is built for modern development environments.

- **Node.js:** `18.0` or higher (recommended: `20.11+` LTS).
- **Bun:** `1.0` or higher.
- **PostgreSQL:** `13` or higher.

*Lower versions of PostgreSQL (down to 9.1) may work due to high compatibility, but versions below 13 are not officially tested or supported.*

## Install

**With npm:**
```bash
npm install @jordey92/tusk pg
```

**With Bun:**
```bash
bun add @jordey92/tusk pg
```

**From GitHub Packages:**
```ini
@jordey92:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install normally:
```bash
npm install @jordey92/tusk pg
# or
bun add @jordey92/tusk pg
```

For GitHub Actions consumers, the workflow needs:
```yaml
permissions:
  contents: read
  packages: read
```

## Usage

**With npm:**
```bash
# Generate initial migration from existing database
npx tusk init

# Create new migration
npx tusk create add_users_table

# Run migrations
npx tusk up

# Rollback migrations
npx tusk down

# Rollback last n migrations
npx tusk down 2

# Show status
npx tusk status
```

**With Bun:**
```bash
bunx tusk init
bunx tusk create add_users_table
bunx tusk up
bunx tusk down
bunx tusk status
```

## Environment Variables

```bash
# Database connection (choose one method)
DATABASE_URL=postgresql://user:pass@localhost:5432/db

# OR individual variables:
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mydb
DB_USER=postgres
DB_PASSWORD=secret

# Optional settings
MIGRATIONS_PATH=./migrations  # default: ./migrations
LOG_LEVEL=info                # debug, info, warn, error
```

## Migration Files

```
migrations/
  1728123456789_add_users_table.up.sql
  1728123456789_add_users_table.down.sql
```

**up.sql:**
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE
);
```

**down.sql:**
```sql
DROP TABLE users;
```

## Programmatic API

**Running migrations programmatically with `pg`:**
```typescript
import { Pool } from 'pg';
import { createPgAdapter, runUp, runDown } from '@jordey92/tusk';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPgAdapter(pool);

// Run all pending migrations
await runUp(adapter, './migrations');

// Rollback last migration
await runDown(adapter, './migrations', 1);
```

**Or with `postgres.js`:**
```typescript
import postgres from 'postgres';
import { createPostgresJsAdapter, runUp, runDown } from '@jordey92/tusk';

const sql = postgres(process.env.DATABASE_URL);
const adapter = createPostgresJsAdapter(sql);

// Run all pending migrations
await runUp(adapter, './migrations');

// Rollback last migration
await runDown(adapter, './migrations', 1);
```

**Generating initial migration from existing database:**
```typescript
import { Pool } from 'pg';
import { createPgAdapter, createInitialMigration } from '@jordey92/tusk';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPgAdapter(pool);

const result = await createInitialMigration(adapter, './migrations');
console.log(`Created migration for ${result.tableCount} tables`);
```

**Using with Elysia (official plugin):**
```typescript
import { Elysia } from 'elysia';
import { migrate } from '@jordey92/tusk';

const app = new Elysia()
  .use(migrate({
    connectionString: process.env.DATABASE_URL,
    migrationsPath: './migrations'
  }))
  .listen(3000);
```

**See [Framework Integration Examples](./docs/integrations.md)** for Express, Fastify, Hono, Koa, NestJS, Next.js, Remix, and more.

## Releasing

Tusk currently publishes to GitHub Packages under `@jordey92/tusk`.

- Manual release steps: [docs/releasing.md](./docs/releasing.md)
- Automated publish workflow: [publish-github-package.yml](./.github/workflows/publish-github-package.yml)

## Testing

Tusk is tested across multiple Node.js and PostgreSQL versions to ensure broad compatibility.

**See [Testing Guide](./docs/testing.md)** for:
- Running compatibility tests across Node.js 18-22
- Testing against PostgreSQL 13-17
- CI/CD integration examples
- Writing and running unit tests

## Architecture

Tusk uses a **Fat Adapter Pattern** to support multiple databases and PostgreSQL clients. All database-specific logic (introspection queries, DDL generation) lives in the adapter, making it easy to add support for new databases.

**Current adapters:**
- PostgreSQL via `pg` library (`createPgAdapter`)
- PostgreSQL via `postgres.js` library (`createPostgresJsAdapter`)

**For contributors:** To add support for a new database (MySQL, SQLite, etc.), implement the `DatabaseAdapter` interface in `types/migrations.ts`. See `adapters/pg.ts` for a reference implementation.

## License

MIT
