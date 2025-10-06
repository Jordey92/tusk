export type {
  DatabaseAdapter,
  TransactionClient,
  QueryResult,
  Migration,
} from "./types/migrations";
export type { ElysiaMigrateConfig } from "./plugins/elysia";

export { runUp, runDown } from "./core/run-migrations";
export { readMigrations } from "./core/read-migrations";
export {
  ensureMigrationsTable,
  getExecutedMigrations,
  getLastExecutedMigrations,
  markAsExecuted,
  markAsRolledBack,
} from "./core/track-migrations";

export { createPostgresAdapter } from "./adapters/postgres";
export { migrate } from "./plugins/elysia";
