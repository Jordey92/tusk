export type {
  DatabaseAdapter,
  TransactionClient,
  QueryResult,
  Migration,
} from "./types/migrations";
export type { ElysiaMigrateConfig } from "./plugins/elysia";
export type {
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
  UniqueConstraintInfo,
  IndexInfo,
  TableInfo,
  IntrospectedSchema,
} from "./types/schema";
export type { MigrationRecord } from "./core/track-migrations";

export { runUp, runDown } from "./core/run-migrations";
export { readMigrations } from "./core/read-migrations";
export {
  ensureMigrationsTable,
  getExecutedMigrations,
  getLastExecutedMigrations,
} from "./core/track-migrations";
export { createInitialMigration } from "./core/init-migration";

export { createPostgresAdapter } from "./adapters/postgres";
export { migrate } from "./plugins/elysia";
