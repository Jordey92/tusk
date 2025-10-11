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
npm install @bydey/tusk pg
```

**With Bun:**
```bash
bun add @bydey/tusk pg
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

**Running migrations programmatically:**
```typescript
import { Pool } from 'pg';
import { createPostgresAdapter, runUp, runDown } from '@bydey/tusk';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPostgresAdapter(pool);

// Run all pending migrations
await runUp(adapter, './migrations');

// Rollback last migration
await runDown(adapter, './migrations', 1);
```

**Generating initial migration from existing database:**
```typescript
import { Pool } from 'pg';
import { createPostgresAdapter, createInitialMigration } from '@bydey/tusk';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPostgresAdapter(pool);

const result = await createInitialMigration(adapter, './migrations');
console.log(`Created migration for ${result.tableCount} tables`);
```

**Using with Elysia (official plugin):**
```typescript
import { Elysia } from 'elysia';
import { migrate } from '@bydey/tusk';

const app = new Elysia()
  .use(migrate({
    connectionString: process.env.DATABASE_URL,
    migrationsPath: './migrations'
  }))
  .listen(3000);
```

**See [Framework Integration Examples](./docs/integrations.md)** for Express, Fastify, Hono, Koa, NestJS, Next.js, Remix, and more.

## Testing

Tusk is tested across multiple Node.js and PostgreSQL versions to ensure broad compatibility.

**See [Testing Guide](./docs/testing.md)** for:
- Running compatibility tests across Node.js 18-22
- Testing against PostgreSQL 13-17
- CI/CD integration examples
- Writing and running unit tests

## Architecture

Tusk uses a **Fat Adapter Pattern** to support multiple databases. All database-specific logic (introspection queries, DDL generation) lives in the adapter, making it easy to add support for new databases.

**Current adapters:**
- PostgreSQL (via `createPostgresAdapter`)

**For contributors:** To add support for a new database (MySQL, SQLite, etc.), implement the `DatabaseAdapter` interface in `types/migrations.ts`. See `adapters/postgres.ts` for a reference implementation.

## License

MIT