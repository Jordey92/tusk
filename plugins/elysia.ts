import { Elysia } from "elysia";
import { Pool } from "pg";
import { createPgAdapter } from "../adapters/pg.js";
import { ensureMigrationsTable } from "../core/track-migrations.js";
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
}

interface PoolHandle {
  pool: Pool;
  ownsPool: boolean;
}

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
  const { pool, ownsPool } = createPoolHandle(config);
  const adapter = createPgAdapter(pool);
  const migrationsPath = config.migrationsPath || "./migrations";
  const runOnStartup = config.runOnStartup ?? true;

  return new Elysia({ name: "migrate" })
    .decorate("db", { pool, adapter })
    .onStart(async () => {
      if (runOnStartup) {
        console.log("🔄 Running migrations...");
        await ensureMigrationsTable(adapter);
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
