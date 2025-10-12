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

export const createPoolFromConfig = (config: ElysiaMigrateConfig): Pool => {
  if (config.pool) {
    return config.pool;
  }

  if (config.connectionString) {
    return new Pool({ connectionString: config.connectionString });
  }

  if (config.connection) {
    return new Pool(config.connection);
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
  });
};

export const migrate = (config: ElysiaMigrateConfig = {}) => {
  const pool = createPoolFromConfig(config);
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
      await pool.end();
    });
};
