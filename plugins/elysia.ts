import { Elysia } from "elysia";
import { Pool } from "pg";
import { createPgAdapter } from "../adapters/pg.js";
import { ensureMigrationsTable } from "../core/track-migrations.js";
import { runUp } from "../core/run-migrations.js";

export interface ElysiaMigrateConfig {
  connectionString?: string;
  pool?: Pool;
  connection?: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  };

  migrationsPath?: string;
  runOnStartup?: boolean;
}

export interface PoolHandle {
  pool: Pool;
  ownsPool: boolean;
}

export const createPoolFromConfig = (config: ElysiaMigrateConfig): Pool => {
  return createPoolHandle(config).pool;
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
  const runOnStartup = config.runOnStartup ?? true; // default to true

  return new Elysia({ name: "migrate" })
    .decorate("db", {
      pool,
      adapter,
    })
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
