import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "path";
import {
  loadDatabaseConfig,
  loadDriverPreference,
  parseIntegerEnvironment,
} from "./config";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});

describe("parseIntegerEnvironment", () => {
  test("returns fallback when unset or empty", () => {
    delete process.env.TUSK_STATEMENT_TIMEOUT_MS;
    expect(parseIntegerEnvironment("TUSK_STATEMENT_TIMEOUT_MS", 300000, { minimum: 0 })).toBe(
      300000
    );

    process.env.TUSK_STATEMENT_TIMEOUT_MS = "";
    expect(parseIntegerEnvironment("TUSK_STATEMENT_TIMEOUT_MS", 300000, { minimum: 0 })).toBe(
      300000
    );
  });

  test("parses a valid integer within bounds", () => {
    process.env.DB_PORT = "5433";
    expect(
      parseIntegerEnvironment("DB_PORT", 5432, { minimum: 1, maximum: 65535 })
    ).toBe(5433);

    process.env.DB_PORT = "1";
    expect(
      parseIntegerEnvironment("DB_PORT", 5432, { minimum: 1, maximum: 65535 })
    ).toBe(1);

    process.env.DB_PORT = "65535";
    expect(
      parseIntegerEnvironment("DB_PORT", 5432, { minimum: 1, maximum: 65535 })
    ).toBe(65535);

    process.env.TUSK_STATEMENT_TIMEOUT_MS = "0";
    expect(
      parseIntegerEnvironment("TUSK_STATEMENT_TIMEOUT_MS", 300000, {
        minimum: 0,
      })
    ).toBe(0);
  });

  test("rejects non-integers and out-of-range values", () => {
    process.env.DB_PORT = "not-a-port";
    expect(() =>
      parseIntegerEnvironment("DB_PORT", 5432, { minimum: 1, maximum: 65535 })
    ).toThrow(/DB_PORT must be an integer/);

    process.env.DB_PORT = "0";
    expect(() =>
      parseIntegerEnvironment("DB_PORT", 5432, { minimum: 1, maximum: 65535 })
    ).toThrow(/DB_PORT must be an integer/);

    process.env.DB_PORT = "65536";
    expect(() =>
      parseIntegerEnvironment("DB_PORT", 5432, { minimum: 1, maximum: 65535 })
    ).toThrow(/DB_PORT must be an integer/);
  });
});

describe("loadDriverPreference", () => {
  test("returns undefined when TUSK_DRIVER is unset", () => {
    delete process.env.TUSK_DRIVER;
    expect(loadDriverPreference()).toBeUndefined();
  });

  test("accepts pg and postgres", () => {
    process.env.TUSK_DRIVER = "pg";
    expect(loadDriverPreference()).toBe("pg");

    process.env.TUSK_DRIVER = "postgres";
    expect(loadDriverPreference()).toBe("postgres");
  });

  test("rejects unknown drivers", () => {
    process.env.TUSK_DRIVER = "mysql";
    expect(() => loadDriverPreference()).toThrow(
      "TUSK_DRIVER must be either pg or postgres"
    );
  });
});

describe("loadDatabaseConfig", () => {
  test("prefers DATABASE_URL with runtime options", () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/app";
    process.env.TUSK_DRIVER = "postgres";
    process.env.TUSK_STATEMENT_TIMEOUT_MS = "60000";
    delete process.env.TUSK_MIGRATION_LOCK_ID;

    expect(loadDatabaseConfig({ migrationsPath: "./migrations" })).toEqual({
      connectionString: "postgresql://user:password@localhost:5432/app",
      driver: "postgres",
      statementTimeoutMs: 60000,
      migrationLockSeed: resolve("./migrations"),
    });
  });

  test("builds config from individual DB_* variables", () => {
    delete process.env.DATABASE_URL;
    process.env.DB_HOST = "db.internal";
    process.env.DB_PORT = "5433";
    process.env.DB_NAME = "app";
    process.env.DB_USER = "user";
    process.env.DB_PASSWORD = "secret";
    delete process.env.TUSK_DRIVER;
    delete process.env.TUSK_STATEMENT_TIMEOUT_MS;
    delete process.env.TUSK_MIGRATION_LOCK_ID;

    expect(loadDatabaseConfig({ migrationsPath: "/app/migrations" })).toEqual({
      host: "db.internal",
      port: 5433,
      database: "app",
      user: "user",
      password: "secret",
      driver: undefined,
      statementTimeoutMs: 300000,
      migrationLockSeed: resolve("/app/migrations"),
    });
  });

  test("defaults host and port when using DB_* variables", () => {
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    process.env.DB_NAME = "app";
    process.env.DB_USER = "user";
    process.env.DB_PASSWORD = "secret";
    delete process.env.TUSK_MIGRATION_LOCK_ID;

    expect(loadDatabaseConfig()).toMatchObject({
      host: "localhost",
      port: 5432,
      database: "app",
      user: "user",
      password: "secret",
    });
  });

  test("requires DB_NAME, DB_USER, and DB_PASSWORD without DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;

    expect(() => loadDatabaseConfig()).toThrow(
      /Missing required database configuration: DB_NAME, DB_USER, DB_PASSWORD/
    );
  });

  test("uses TUSK_MIGRATION_LOCK_ID when set", () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/app";
    process.env.TUSK_MIGRATION_LOCK_ID = "999001";
    delete process.env.TUSK_DRIVER;
    delete process.env.TUSK_STATEMENT_TIMEOUT_MS;

    expect(loadDatabaseConfig({ migrationsPath: "./migrations" })).toEqual({
      connectionString: "postgresql://user:password@localhost:5432/app",
      driver: undefined,
      statementTimeoutMs: 300000,
      migrationLockId: 999001,
    });
  });

  test("rejects an invalid TUSK_MIGRATION_LOCK_ID", () => {
    process.env.DATABASE_URL = "postgresql://user:password@localhost:5432/app";
    process.env.TUSK_MIGRATION_LOCK_ID = "nope";

    expect(() => loadDatabaseConfig()).toThrow(/Invalid migrationLockId/);
  });
});
