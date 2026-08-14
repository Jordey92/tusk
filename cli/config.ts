import type { PostgresClientConfig, SupportedPostgresDriver } from "../adapters/postgres-client.js";
import { createConfigurationError } from "../utils/errors.js";
import { resolveConfiguredMigrationLock } from "../utils/migration-lock-id.js";

type DatabaseConfig = PostgresClientConfig;

type LoadDatabaseConfigOptions = {
  /** Migrations directory used to derive the advisory lock seed. */
  migrationsPath?: string;
};

export const parseIntegerEnvironment = (
  name: string,
  fallback: number,
  options: { minimum: number; maximum?: number }
) => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") return fallback;

  const value = Number(rawValue);
  if (
    !Number.isSafeInteger(value) ||
    value < options.minimum ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    throw createConfigurationError(
      `${name} must be an integer between ${options.minimum} and ${options.maximum ?? "the safe integer limit"}`,
      { name, value: rawValue }
    );
  }

  return value;
};

export const loadDriverPreference = (): SupportedPostgresDriver | undefined => {
  const driver = process.env.TUSK_DRIVER;
  if (!driver) return undefined;
  if (driver === "pg" || driver === "postgres") return driver;
  throw createConfigurationError(
    "TUSK_DRIVER must be either pg or postgres",
    { driver }
  );
};

const loadMigrationLockOptions = (migrationsPath?: string) => {
  try {
    return resolveConfiguredMigrationLock({
      migrationsPath,
      lockIdEnv: process.env.TUSK_MIGRATION_LOCK_ID,
    });
  } catch (error) {
    throw createConfigurationError(
      error instanceof Error ? error.message : String(error),
      {
        name: "TUSK_MIGRATION_LOCK_ID",
        value: process.env.TUSK_MIGRATION_LOCK_ID,
      }
    );
  }
};

const validateDatabaseConfig = (config: DatabaseConfig) => {
  if (config.connectionString) {
    return;
  }

  const missing = [];
  if (!config.database) missing.push("DB_NAME");
  if (!config.user) missing.push("DB_USER");
  if (!config.password) missing.push("DB_PASSWORD");

  if (missing.length > 0) {
    throw createConfigurationError(
      `Missing required database configuration: ${missing.join(", ")}. ` +
        `Provide DATABASE_URL or individual environment variables.`,
      { missing }
    );
  }
};

export const loadDatabaseConfig = (
  options: LoadDatabaseConfigOptions = {}
): DatabaseConfig => {
  const runtimeOptions = {
    driver: loadDriverPreference(),
    statementTimeoutMs: parseIntegerEnvironment(
      "TUSK_STATEMENT_TIMEOUT_MS",
      300000,
      { minimum: 0 }
    ),
    ...loadMigrationLockOptions(options.migrationsPath),
  };

  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ...runtimeOptions };
  }

  const config: DatabaseConfig = {
    host: process.env.DB_HOST || "localhost",
    port: parseIntegerEnvironment("DB_PORT", 5432, {
      minimum: 1,
      maximum: 65535,
    }),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ...runtimeOptions,
  };

  validateDatabaseConfig(config);
  return config;
};
