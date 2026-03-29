# Framework Integrations

Tusk provides a simple programmatic API that works with any JavaScript/TypeScript framework. Below are integration examples for popular frameworks.

## Table of Contents

- [Elysia](#elysia) (Official Plugin)
- [Express](#express)
- [Fastify](#fastify)
- [Hono](#hono)
- [Koa](#koa)
- [NestJS](#nestjs)
- [Next.js](#nextjs)
- [Remix](#remix)

---

## Elysia

Tusk provides an official Elysia plugin with automatic migration running and database decorator support.

```typescript
import { Elysia } from 'elysia';
import { migrate } from '@jordey92/tusk';

const app = new Elysia()
  .use(migrate({
    connectionString: process.env.DATABASE_URL,
    migrationsPath: './migrations',
    runOnStartup: true // default
  }))
  .get('/users', async ({ db }) => {
    // Access db.pool or db.adapter
    const result = await db.pool.query('SELECT * FROM users');
    return result.rows;
  })
  .listen(3000);

console.log('Server running on http://localhost:3000');
```

**Configuration options:**

```typescript
interface ElysiaMigrateConfig {
  // Choose one connection method:
  connectionString?: string;           // e.g., "postgresql://..."
  pool?: Pool;                        // Existing pg Pool
  connection?: {                      // Individual config
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  };

  migrationsPath?: string;            // default: "./migrations"
  runOnStartup?: boolean;             // default: true
}
```

---

## Express

```typescript
import express from 'express';
import { Pool } from 'pg';
import { createPgAdapter, runUp, ensureMigrationsTable } from '@jordey92/tusk';

const app = express();

// Setup database and migrations
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = createPgAdapter(pool);

// Run migrations on startup
const runMigrations = async () => {
  try {
    console.log('🔄 Running migrations...');
    await ensureMigrationsTable(adapter);
    const result = await runUp(adapter, './migrations');
    console.log(`✓ Executed ${result.executed} migration(s)`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

// Make db available to routes
app.locals.db = { pool, adapter };

// Example route
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Start server after migrations
runMigrations().then(() => {
  app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
  });
});

// Cleanup on shutdown
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
```

**With middleware approach:**

```typescript
import express from 'express';
import { Pool } from 'pg';
import { createPgAdapter } from '@jordey92/tusk';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPgAdapter(pool);

// Middleware to inject db into requests
const dbMiddleware = (req, res, next) => {
  req.db = { pool, adapter };
  next();
};

const app = express();
app.use(dbMiddleware);

app.get('/users', async (req, res) => {
  const result = await req.db.pool.query('SELECT * FROM users');
  res.json(result.rows);
});
```

---

## Fastify

```typescript
import Fastify from 'fastify';
import { Pool } from 'pg';
import { createPgAdapter, runUp, ensureMigrationsTable } from '@jordey92/tusk';

const fastify = Fastify({
  logger: true
});

// Setup database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = createPgAdapter(pool);

// Decorate fastify with db
fastify.decorate('db', { pool, adapter });

// Run migrations on ready hook
fastify.addHook('onReady', async () => {
  try {
    fastify.log.info('Running migrations...');
    await ensureMigrationsTable(adapter);
    const result = await runUp(adapter, './migrations');
    fastify.log.info(`Executed ${result.executed} migration(s)`);
  } catch (error) {
    fastify.log.error('Migration failed:', error);
    throw error;
  }
});

// Cleanup on close
fastify.addHook('onClose', async () => {
  await pool.end();
});

// Example route
fastify.get('/users', async (request, reply) => {
  const result = await fastify.db.pool.query('SELECT * FROM users');
  return result.rows;
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
```

**As a Fastify plugin:**

```typescript
import fp from 'fastify-plugin';
import { Pool } from 'pg';
import { createPgAdapter, runUp, ensureMigrationsTable } from '@jordey92/tusk';

const tuskPlugin = fp(async (fastify, options) => {
  const pool = new Pool({
    connectionString: options.connectionString || process.env.DATABASE_URL
  });
  const adapter = createPgAdapter(pool);

  fastify.decorate('db', { pool, adapter });

  if (options.runOnStartup !== false) {
    await ensureMigrationsTable(adapter);
    const result = await runUp(adapter, options.migrationsPath || './migrations');
    fastify.log.info(`Executed ${result.executed} migration(s)`);
  }

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});

// Usage
fastify.register(tuskPlugin, {
  connectionString: process.env.DATABASE_URL,
  migrationsPath: './migrations',
  runOnStartup: true
});
```

---

## Hono

```typescript
import { Hono } from 'hono';
import { Pool } from 'pg';
import { createPgAdapter, runUp, ensureMigrationsTable } from '@jordey92/tusk';

const app = new Hono();

// Setup database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = createPgAdapter(pool);

// Run migrations before starting
console.log('🔄 Running migrations...');
await ensureMigrationsTable(adapter);
const result = await runUp(adapter, './migrations');
console.log(`✓ Executed ${result.executed} migration(s)`);

// Add db to context
app.use('*', async (c, next) => {
  c.set('db', { pool, adapter });
  await next();
});

// Example route
app.get('/users', async (c) => {
  const db = c.get('db');
  const result = await db.pool.query('SELECT * FROM users');
  return c.json(result.rows);
});

export default app;
```

**For Cloudflare Workers with Hono:**

```typescript
import { Hono } from 'hono';
// Note: Use a Postgres-compatible driver for Cloudflare Workers
// such as @neondatabase/serverless or Hyperdrive

const app = new Hono();

app.get('/migrate', async (c) => {
  // Trigger migrations via HTTP endpoint
  // Recommended: Use a separate service or Cloudflare Cron Trigger
  return c.json({ message: 'Use npx tusk up locally or in CI/CD' });
});

export default app;
```

---

## Koa

```typescript
import Koa from 'koa';
import Router from '@koa/router';
import { Pool } from 'pg';
import { createPgAdapter, runUp, ensureMigrationsTable } from '@jordey92/tusk';

const app = new Koa();
const router = new Router();

// Setup database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = createPgAdapter(pool);

// Add db to context
app.context.db = { pool, adapter };

// Run migrations on startup
const runMigrations = async () => {
  try {
    console.log('🔄 Running migrations...');
    await ensureMigrationsTable(adapter);
    const result = await runUp(adapter, './migrations');
    console.log(`✓ Executed ${result.executed} migration(s)`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

// Example route
router.get('/users', async (ctx) => {
  const result = await ctx.db.pool.query('SELECT * FROM users');
  ctx.body = result.rows;
});

app.use(router.routes());
app.use(router.allowedMethods());

// Start server after migrations
runMigrations().then(() => {
  app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
  });
});
```

---

## NestJS

**Create a migration module:**

```typescript
// src/database/migration.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { createPgAdapter, runUp, ensureMigrationsTable } from '@jordey92/tusk';

@Module({})
export class MigrationModule implements OnModuleInit {
  async onModuleInit() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    const adapter = createPgAdapter(pool);

    console.log('🔄 Running migrations...');
    await ensureMigrationsTable(adapter);
    const result = await runUp(adapter, './migrations');
    console.log(`✓ Executed ${result.executed} migration(s)`);
  }
}
```

**Database service with Tusk:**

```typescript
// src/database/database.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { createPgAdapter } from '@jordey92/tusk';
import type { DatabaseAdapter } from '@jordey92/tusk';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  public readonly pool: Pool;
  public readonly adapter: DatabaseAdapter;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.adapter = createPgAdapter(this.pool);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query(sql: string, params?: any[]) {
    return this.adapter.query(sql, params);
  }
}
```

**Database module:**

```typescript
// src/database/database.module.ts
import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { MigrationModule } from './migration.module';

@Global()
@Module({
  imports: [MigrationModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
```

**Usage in a controller:**

```typescript
// src/users/users.controller.ts
import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('users')
export class UsersController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async findAll() {
    const result = await this.db.query('SELECT * FROM users');
    return result.rows;
  }
}
```

---

## Next.js

**App Router (Next.js 13+):**

```typescript
// lib/db.ts
import { Pool } from 'pg';
import { createPgAdapter } from '@jordey92/tusk';

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

export const pool = globalForDb.pool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const adapter = createPgAdapter(pool);

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}
```

**Run migrations script:**

```typescript
// scripts/migrate.ts
import { pool, adapter } from '../lib/db';
import { runUp, ensureMigrationsTable } from '@jordey92/tusk';

async function migrate() {
  try {
    console.log('🔄 Running migrations...');
    await ensureMigrationsTable(adapter);
    const result = await runUp(adapter, './migrations');
    console.log(`✓ Executed ${result.executed} migration(s)`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
```

**package.json:**

```json
{
  "scripts": {
    "db:migrate": "tsx scripts/migrate.ts",
    "dev": "npm run db:migrate && next dev",
    "build": "npm run db:migrate && next build"
  }
}
```

**API Route:**

```typescript
// app/api/users/route.ts
import { pool } from '@/lib/db';

export async function GET() {
  const result = await pool.query('SELECT * FROM users');
  return Response.json(result.rows);
}
```

**Server Action:**

```typescript
// app/actions/users.ts
'use server';

import { pool } from '@/lib/db';

export async function getUsers() {
  const result = await pool.query('SELECT * FROM users');
  return result.rows;
}
```

---

## Remix

**Database utility:**

```typescript
// app/lib/db.server.ts
import { Pool } from 'pg';
import { createPgAdapter } from '@jordey92/tusk';

let pool: Pool;

declare global {
  var __db__: Pool;
}

if (process.env.NODE_ENV === 'production') {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
} else {
  if (!global.__db__) {
    global.__db__ = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  pool = global.__db__;
}

export const db = {
  pool,
  adapter: createPgAdapter(pool),
};
```

**Migration script:**

```typescript
// scripts/migrate.ts
import { db } from '../app/lib/db.server';
import { runUp, ensureMigrationsTable } from '@jordey92/tusk';

async function migrate() {
  try {
    console.log('🔄 Running migrations...');
    await ensureMigrationsTable(db.adapter);
    const result = await runUp(db.adapter, './migrations');
    console.log(`✓ Executed ${result.executed} migration(s)`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

migrate();
```

**Loader example:**

```typescript
// app/routes/users.tsx
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { db } from '~/lib/db.server';

export async function loader() {
  const result = await db.pool.query('SELECT * FROM users');
  return json({ users: result.rows });
}

export default function Users() {
  const { users } = useLoaderData<typeof loader>();

  return (
    <div>
      <h1>Users</h1>
      <ul>
        {users.map(user => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Common Patterns

### Environment-based Configuration

```typescript
import { Pool } from 'pg';
import { createPgAdapter } from '@jordey92/tusk';

const config = {
  development: {
    connectionString: process.env.DATABASE_URL,
  },
  test: {
    connectionString: process.env.TEST_DATABASE_URL,
  },
  production: {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // For services like Heroku
    },
    max: 20, // Connection pool size
  },
};

const env = process.env.NODE_ENV || 'development';
const pool = new Pool(config[env]);
const adapter = createPgAdapter(pool);
```

### Conditional Migration Running

```typescript
import { runUp, ensureMigrationsTable } from '@jordey92/tusk';

// Only run migrations in development, use separate migration process in production
const shouldRunMigrations =
  process.env.RUN_MIGRATIONS === 'true' ||
  process.env.NODE_ENV === 'development';

if (shouldRunMigrations) {
  await ensureMigrationsTable(adapter);
  await runUp(adapter, './migrations');
}
```

### Health Check Endpoint

```typescript
// Example for any framework
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    });
  }
});
```

### Transaction Helper

```typescript
import { DatabaseAdapter } from '@jordey92/tusk';

async function withTransaction<T>(
  adapter: DatabaseAdapter,
  callback: (client: TransactionClient) => Promise<T>
): Promise<T> {
  return adapter.transaction(callback);
}

// Usage
await withTransaction(adapter, async (client) => {
  await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice']);
  await client.query('INSERT INTO posts (user_id, title) VALUES ($1, $2)', [1, 'Hello']);
  // Both queries committed together, or rolled back on error
});
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Migrations

on:
  push:
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - run: bun install

      - name: Run migrations
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: bunx tusk up
```

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Run migrations on container start
CMD ["sh", "-c", "npx tusk up && node dist/index.js"]
```

---

## Tips

1. **Always run migrations before starting your server** to ensure schema is up-to-date
2. **Use environment variables** for database configuration
3. **In production**, consider running migrations separately via CI/CD rather than on app startup
4. **Use connection pooling** - Tusk works with `pg` Pool for efficient connections
5. **Handle cleanup** - Close database connections when your app shuts down
6. **Test migrations** in staging environment before production

## Need Help?

- [GitHub Issues](https://github.com/bydey/tusk/issues)
- [Main Documentation](../README.md)
