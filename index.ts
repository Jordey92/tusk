export type {
  DatabaseAdapter,
  TransactionClient,
  QueryResult,
  Migration,
} from "./types/migrations.js";
export type { ElysiaMigrateConfig } from "./plugins/elysia.js";
export type {
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
  UniqueConstraintInfo,
  IndexInfo,
  TableInfo,
  IntrospectedSchema,
} from "./types/schema.js";
export type { MigrationRecord } from "./core/track-migrations.js";

export { runUp, runDown } from "./core/run-migrations.js";
export { readMigrations } from "./core/read-migrations.js";
export {
  ensureMigrationsTable,
  getExecutedMigrations,
  getLastExecutedMigrations,
} from "./core/track-migrations.js";
export { createInitialMigration } from "./core/init-migration.js";

export { createPostgresAdapter } from "./adapters/postgres.js";
export { migrate } from "./plugins/elysia.js";
