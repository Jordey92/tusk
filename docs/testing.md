# Testing Tusk

This guide covers how to test Tusk across different Node.js and PostgreSQL versions to ensure compatibility.

---

## Prerequisites

- **Docker** and **Docker Compose** installed
- **nvm** (Node Version Manager) installed
- **Bun** installed (for running tests)

---

## Testing Against Multiple Node.js Versions

Tusk includes a compatibility test script that validates the build, CLI, and programmatic API across different Node.js versions.

### Run the test:

```bash
./test-compatibility.sh
```

### What it tests:

- **Node.js 14, 16, 18, 20, 22**
- Build process with TypeScript
- CLI execution (`tusk --version`)
- Programmatic module imports

### Expected results:

| Node Version | Status |
|--------------|--------|
| 14.x | ❌ Not supported (EOL) |
| 16.x | ⚠️ Partial (CLI only, EOL) |
| 18.x | ✅ Fully supported |
| 20.x | ✅ Fully supported (recommended) |
| 22.x | ✅ Fully supported |

---

## Testing Against Multiple PostgreSQL Versions

Tusk includes a Docker Compose configuration and test script for validating compatibility across PostgreSQL versions.

### Available PostgreSQL versions:

- PostgreSQL 13 (minimum supported version)
- PostgreSQL 14
- PostgreSQL 15
- PostgreSQL 16
- PostgreSQL 17 (latest)

### Run all tests:

```bash
./test-postgres-versions.sh
```

This will:
1. Start each PostgreSQL version in Docker
2. Run the full test suite against it
3. Collect results
4. Clean up containers and volumes

⏱️ **Note:** This takes 5-10 minutes to complete.

### Test a single version manually:

```bash
# Start PostgreSQL 13
docker-compose -f docker-compose.test.yml up -d postgres-13

# Set environment variables
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=migrate_tool_test
export DB_USER=test_user
export DB_PASSWORD=test_password

# Run tests
bun test

# Clean up
docker-compose -f docker-compose.test.yml down
```

### PostgreSQL port mappings:

| Version | Port |
|---------|------|
| 13 | 5432 |
| 14 | 5433 |
| 15 | 5434 |
| 16 | 5435 |
| 17 | 5436 |

---

## Running Unit Tests

Tusk uses Bun's built-in test runner for unit tests.

### Run all tests:

```bash
bun test
```

### Run specific test files:

```bash
bun test core/run-migrations.test.ts
```

### Test with coverage:

```bash
bun test --coverage
```

---

## Writing Tests

Tests are located alongside the source files with the `.test.ts` extension.

### Example test structure:

```typescript
import { test, expect } from "bun:test";
import { yourFunction } from "./your-module.js";

test("should do something", () => {
  const result = yourFunction();
  expect(result).toBe(expected);
});
```

### Database test setup:

Tests use a dedicated test database configured via environment variables:

```typescript
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "migrate_tool_test",
  user: process.env.DB_USER || "test_user",
  password: process.env.DB_PASSWORD || "test_password",
});
```

---

## Continuous Integration

For CI/CD pipelines, use the provided test scripts:

```yaml
# Example GitHub Actions workflow
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:13-alpine
        env:
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_password
          POSTGRES_DB: migrate_tool_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - run: bun install
      - run: bun test
```

---

## Troubleshooting

### Tests fail with "database does not exist"

Make sure PostgreSQL is running and the test database exists:

```bash
# Create test database manually
createdb -h localhost -U test_user migrate_tool_test
```

### Docker containers won't start

Check if ports are already in use:

```bash
lsof -i :5432
```

Stop conflicting services or use different ports in `docker-compose.test.yml`.

### nvm command not found

Make sure nvm is properly installed and sourced in your shell:

```bash
# Add to ~/.bashrc or ~/.zshrc
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

---

## Test Coverage

Current test coverage includes:

- ✅ Migration execution (up/down)
- ✅ Schema introspection
- ✅ SQL generation
- ✅ Checksum validation
- ✅ Advisory locking
- ✅ Transaction rollback
- ✅ Error handling
- ✅ CLI commands

Run `bun test` to see the full suite (200+ tests).
