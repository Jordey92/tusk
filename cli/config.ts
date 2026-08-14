import type { PostgresClientConfig, SupportedPostgresDriver } from "../adapters/postgres-client.js";
import { createConfigurationError } from "../utils/errors.js";
import { resolveConfiguredMigrationLock } from "../utils/migration-lock-id.js";
import type { TuskProjectFileConfig } from "./project-config.js";

type DatabaseConfig = PostgresClientConfig;

type LoadDatabaseConfigOptions = {
  /** Unused for lock identity; kept for call-site compatibility. */
  migrationsPath?: string;
  projectConfig?: TuskProjectFileConfig;
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

export const loadDriverPreference = (
  fileDriver?: SupportedPostgresDriver
): SupportedPostgresDriver | undefined => {
  const driver = process.env.TUSK_DRIVER || fileDriver;
  if (!driver) return undefined;
  if (driver === "pg" || driver === "postgres") return driver;
  throw createConfigurationError(
    "TUSK_DRIVER must be either pg or postgres",
    { driver }
  );
};

const loadMigrationLockOptions = () => {
  try {
    return resolveConfiguredMigrationLock({
      lockIdEnv: process.env.TUSK_MIGRATION_LOCK_ID,
      seedEnv: process.env.TUSK_MIGRATION_LOCK_SEED,
    });
  } catch (error) {
    const invalidLockId = process.env.TUSK_MIGRATION_LOCK_ID;
    throw createConfigurationError(
      error instanceof Error ? error.message : String(error),
      {
        name: invalidLockId ? "TUSK_MIGRATION_LOCK_ID" : "TUSK_MIGRATION_LOCK_SEED",
        value: invalidLockId || process.env.TUSK_MIGRATION_LOCK_SEED,
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
  const projectConfig = options.projectConfig ?? {};
  const runtimeOptions = {
    driver: loadDriverPreference(projectConfig.driver),
    statementTimeoutMs: parseIntegerEnvironment(
      "TUSK_STATEMENT_TIMEOUT_MS",
      projectConfig.statementTimeoutMs ?? 300000,
      { minimum: 0 }
    ),
    ...loadMigrationLockOptions(),
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
