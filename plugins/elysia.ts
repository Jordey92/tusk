import { Pool } from "pg";
import { createRequire } from "module";
import { createPgAdapter } from "../adapters/pg.js";
import { runUp } from "../core/run-migrations.js";
import type { ConnectionConfig } from "../types/migrations.js";

/**
 * Connection settings accepted by the Elysia migration plugin.
 */
export interface ElysiaMigrateConfig {
  connectionString?: string;
  pool?: Pool;
  connection?: ConnectionConfig;

  migrationsPath?: string;
  runOnStartup?: boolean;
  statementTimeoutMs?: number;
}

interface PoolHandle {
  pool: Pool;
  ownsPool: boolean;
}

const requireElysia = createRequire(import.meta.url);

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

  return {
    pool: new Pool({
      connectionString: process.env.DATABASE_URL,
    }),
    ownsPool: true,
  };
};

export const migrate = (config: ElysiaMigrateConfig = {}) => {
  const { Elysia } = requireElysia("elysia") as typeof import("elysia");
  const { pool, ownsPool } = createPoolHandle(config);
  const adapter = createPgAdapter(pool, {
    statementTimeoutMs: config.statementTimeoutMs,
  });
  const migrationsPath = config.migrationsPath || "./migrations";
  const runOnStartup = config.runOnStartup ?? true;

  return new Elysia({ name: "migrate" })
    .decorate("db", { pool, adapter })
    .onStart(async () => {
      if (runOnStartup) {
        console.log("🔄 Running migrations...");
        const result = await runUp(adapter, migrationsPath);
        console.log(`✓ Executed ${result.executed} migration(s)`);
      }
    })
    .onStop(async () => {
      if (ownsPool) {
        await pool.end();
      }
    });
};
