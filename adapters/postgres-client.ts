import type {
  ConnectionConfig,
  ConnectionPool,
  DatabaseAdapter,
} from "../types/migrations.js";
import {
  createDatabaseError,
  createDriverNotFoundError,
  toError,
} from "../utils/errors.js";
import { createPgAdapter } from "./pg.js";
import { createPostgresJsAdapter } from "./postgresjs.js";

export type SupportedPostgresDriver = "pg" | "postgres";

export interface PostgresClientConfig extends ConnectionConfig {
  connectionString?: string;
}

export interface ManagedPostgresAdapter {
  driver: SupportedPostgresDriver;
  adapter: DatabaseAdapter;
  cleanup(): Promise<void>;
}

interface ResolvePostgresClientOptions {
  importModule?: (specifier: string) => Promise<unknown>;
}

type PgPool = ConnectionPool & {
  end(): Promise<void>;
};

type PgPoolConstructor = new (config: PostgresClientConfig) => PgPool;

type PostgresJsSql = Parameters<typeof createPostgresJsAdapter>[0] & {
  end(): Promise<void>;
};

type PostgresJsFactory = {
  (url: string): PostgresJsSql;
  (options: Record<string, unknown>): PostgresJsSql;
};

const defaultImportModule = (specifier: string) => import(specifier);

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;

const errorCode = (error: unknown) =>
  toRecord(error)?.code;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isMissingPackageError = (error: unknown, packageName: string) => {
  if (errorCode(error) !== "ERR_MODULE_NOT_FOUND") {
    return false;
  }

  const message = errorMessage(error);
  return (
    message.includes(`'${packageName}'`) ||
    message.includes(`"${packageName}"`) ||
    message.includes(`package ${packageName}`) ||
    message.includes(`module ${packageName}`)
  );
};

const loadOptionalModule = async (
  packageName: string,
  importModule: (specifier: string) => Promise<unknown>
) => {
  try {
    return await importModule(packageName);
  } catch (error) {
    if (isMissingPackageError(error, packageName)) {
      return undefined;
    }

    throw createDatabaseError(
      `Installed ${packageName} package could not be loaded`,
      toError(error),
      { packageName }
    );
  }
};

const getPgPoolConstructor = (
  moduleValue: unknown
): PgPoolConstructor | undefined => {
  const moduleRecord = toRecord(moduleValue);
  const defaultRecord = toRecord(moduleRecord?.default);
  const poolConstructor = moduleRecord?.Pool ?? defaultRecord?.Pool;

  return typeof poolConstructor === "function"
    ? poolConstructor as PgPoolConstructor
    : undefined;
};

const resolvePgPoolConstructor = async (
  importModule: (specifier: string) => Promise<unknown>
) => {
  const moduleValue = await loadOptionalModule("pg", importModule);
  if (!moduleValue) {
    return undefined;
  }

  const Pool = getPgPoolConstructor(moduleValue);
  if (!Pool) {
    throw createDatabaseError(
      "Installed pg package did not export a Pool constructor",
      undefined,
      { packageName: "pg" }
    );
  }

  return Pool;
};

const getPostgresJsFactory = (
  moduleValue: unknown
): PostgresJsFactory | undefined => {
  const moduleRecord = toRecord(moduleValue);
  const factory = moduleRecord?.default ?? moduleValue;

  return typeof factory === "function"
    ? factory as PostgresJsFactory
    : undefined;
};

const resolvePostgresJsFactory = async (
  importModule: (specifier: string) => Promise<unknown>
) => {
  const moduleValue = await loadOptionalModule("postgres", importModule);
  if (!moduleValue) {
    return undefined;
  }

  const factory = getPostgresJsFactory(moduleValue);
  if (!factory) {
    throw createDatabaseError(
      "Installed postgres package did not export a client factory",
      undefined,
      { packageName: "postgres" }
    );
  }

  return factory;
};

const createPostgresJsOptions = (
  config: PostgresClientConfig
): Record<string, unknown> => ({
  host: config.host,
  port: config.port,
  database: config.database,
  user: config.user,
  password: config.password,
});

export const resolvePostgresClientDriver = async (
  options: ResolvePostgresClientOptions = {}
): Promise<SupportedPostgresDriver> => {
  const importModule = options.importModule ?? defaultImportModule;

  if (await resolvePgPoolConstructor(importModule)) {
    return "pg";
  }

  if (await resolvePostgresJsFactory(importModule)) {
    return "postgres";
  }

  throw createDriverNotFoundError();
};

export const createManagedPostgresAdapter = async (
  config: PostgresClientConfig,
  options: ResolvePostgresClientOptions = {}
): Promise<ManagedPostgresAdapter> => {
  const importModule = options.importModule ?? defaultImportModule;
  const PgPool = await resolvePgPoolConstructor(importModule);

  if (PgPool) {
    const pool = new PgPool(config);
    return {
      driver: "pg",
      adapter: createPgAdapter(pool),
      cleanup: () => pool.end(),
    };
  }

  const postgresFactory = await resolvePostgresJsFactory(importModule);
  if (postgresFactory) {
    const sql = config.connectionString
      ? postgresFactory(config.connectionString)
      : postgresFactory(createPostgresJsOptions(config));

    return {
      driver: "postgres",
      adapter: createPostgresJsAdapter(sql),
      cleanup: () => sql.end(),
    };
  }

  throw createDriverNotFoundError();
};
