import { Pool } from "pg";
import { createRequire } from "module";
import type postgres from "postgres";
import { createPgAdapter } from "../adapters/pg.js";
import { createPostgresJsAdapter } from "../adapters/postgresjs.js";
import { runUp } from "../core/run-migrations.js";
import type { ConnectionConfig, DatabaseAdapter } from "../types/migrations.js";
import {
  createConfigurationError,
  formatTuskError,
  isTuskError,
} from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { resolveConfiguredMigrationLock } from "../utils/migration-lock-id.js";

/**
 * Connection settings accepted by the Elysia migration plugin.
 */
export interface ElysiaMigrateConfig {
  connectionString?: string;
  pool?: Pool;
  sql?: postgres.Sql;
  connection?: ConnectionConfig;

  migrationsPath?: string;
  runOnStartup?: boolean;
  statementTimeoutMs?: number;
  migrationLockId?: number;
  migrationLockSeed?: string;
}

interface PoolHandle {
  pool: Pool;
  ownsPool: boolean;
}

export interface ElysiaMigrateHandle {
  adapter: DatabaseAdapter;
  pool?: Pool;
  sql?: postgres.Sql;
  stop: () => Promise<void>;
}

export interface ElysiaStartupMigrationOptions {
  runOnStartup: boolean;
  implicitStartup: boolean;
  adapter: DatabaseAdapter;
  migrationsPath: string;
}

export interface ElysiaMigrateDeps {
  runUp: typeof runUp;
  logger: Pick<typeof logger, "info" | "warn" | "error">;
}

const requireElysia = createRequire(import.meta.url);

const defaultDeps: ElysiaMigrateDeps = {
  runUp,
  logger,
};

const resolveStatementTimeoutMs = (configured?: number): number | undefined => {
  if (configured !== undefined) {
    return configured;
  }

  const rawValue = process.env.TUSK_STATEMENT_TIMEOUT_MS;
  if (rawValue === undefined || rawValue === "") {
    return undefined;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createConfigurationError(
      "TUSK_STATEMENT_TIMEOUT_MS must be a non-negative integer",
      { name: "TUSK_STATEMENT_TIMEOUT_MS", value: rawValue }
    );
  }

  return value;
};

const adapterOptions = (config: ElysiaMigrateConfig) => {
  const envLock = resolveConfiguredMigrationLock({
    lockIdEnv: process.env.TUSK_MIGRATION_LOCK_ID,
    seedEnv: process.env.TUSK_MIGRATION_LOCK_SEED,
  });

  return {
    statementTimeoutMs: resolveStatementTimeoutMs(config.statementTimeoutMs),
    migrationLockId: config.migrationLockId ?? envLock.migrationLockId,
    migrationLockSeed: config.migrationLockSeed ?? envLock.migrationLockSeed,
  };
};

/**
 * Resolves the pool to use for the plugin and whether the plugin owns its lifecycle.
 */
export const createPoolHandle = (config: ElysiaMigrateConfig): PoolHandle => {
  if (config.pool) {
    return {
      pool: config.pool,
      ownsPool: false,
    };
  }

  if (config.connectionString) {
    return {
      pool: new Pool({ connectionString: config.connectionString }),
      ownsPool: true,
    };
  }

  if (config.connection) {
    return {
      pool: new Pool(config.connection),
      ownsPool: true,
    };
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw createConfigurationError(
      "Missing database configuration. Pass pool, sql, connectionString, or connection, or set DATABASE_URL.",
      { name: "DATABASE_URL" }
    );
  }

  return {
    pool: new Pool({ connectionString }),
    ownsPool: true,
  };
};

export const createMigrateHandle = (
  config: ElysiaMigrateConfig
): ElysiaMigrateHandle => {
  if (config.pool && config.sql) {
    throw createConfigurationError(
      "Elysia migrate() accepts either pool or sql, not both"
    );
  }

  if (config.sql) {
    return {
      adapter: createPostgresJsAdapter(config.sql, adapterOptions(config)),
      sql: config.sql,
      stop: async () => {},
    };
  }

  const { pool, ownsPool } = createPoolHandle(config);
  return {
    adapter: createPgAdapter(pool, adapterOptions(config)),
    pool,
    stop: async () => {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
};

export const runElysiaStartupMigrations = async (
  options: ElysiaStartupMigrationOptions,
  deps: ElysiaMigrateDeps = defaultDeps
) => {
  if (!options.runOnStartup) {
    return;
  }

  if (options.implicitStartup) {
    deps.logger.warn(
      "Elysia plugin runOnStartup defaults to true. Prefer a dedicated deploy-step migration, or set runOnStartup: false when deployment already migrates. Set runOnStartup: true to keep startup migrations without this warning.",
      { migrationsPath: options.migrationsPath }
    );
  }

  try {
    const result = await deps.runUp(options.adapter, options.migrationsPath);
    deps.logger.info("Elysia plugin finished startup migrations", {
      executed: result.executed,
      migrationsPath: options.migrationsPath,
    });
    return result;
  } catch (error) {
    if (isTuskError(error)) {
      deps.logger.error("Elysia plugin startup migration failed", {
        error: formatTuskError(error),
        code: error.code,
      });
    } else {
      deps.logger.error("Elysia plugin startup migration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    throw error;
  }
};

export const migrate = (
  config: ElysiaMigrateConfig = {},
  deps: ElysiaMigrateDeps = defaultDeps
) => {
  const { Elysia } = requireElysia("elysia") as typeof import("elysia");
  const handle = createMigrateHandle(config);
  const migrationsPath = config.migrationsPath || "./migrations";
  const implicitStartup = config.runOnStartup === undefined;
  const runOnStartup = config.runOnStartup ?? true;

  return new Elysia({ name: "migrate" })
    .decorate("db", {
      pool: handle.pool,
      sql: handle.sql,
      adapter: handle.adapter,
    })
    .onStart(async () => {
      await runElysiaStartupMigrations(
        {
          runOnStartup,
          implicitStartup,
          adapter: handle.adapter,
          migrationsPath,
        },
        deps
      );
    })
    .onStop(async () => {
      await handle.stop();
    });
};
