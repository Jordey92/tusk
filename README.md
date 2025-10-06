# Tusk

Simple PostgreSQL migration tool for Bun.

## Install

```bash
bun add @jordey92/tusk pg
```

## Usage

```bash
# Create migration
bunx tusk create add_users_table

# Run migrations
bunx tusk up

# Rollback migrations
bunx tusk down

# Show status
bunx tusk status
```

## Environment

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/db
MIGRATIONS_PATH=./migrations  # optional
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

```typescript
import { Pool } from 'pg';
import { createPostgresAdapter, runUp } from '@jordey92/tusk';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = createPostgresAdapter(pool);

await runUp(adapter, './migrations');
```

## License

MIT