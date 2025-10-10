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

export { runUp, runDown } from "./core/run-migrations";
export { readMigrations } from "./core/read-migrations";
export {
  ensureMigrationsTable,
  getExecutedMigrations,
  getLastExecutedMigrations,
  markAsExecuted,
  markAsRolledBack,
} from "./core/track-migrations";
export {
  introspectDatabase,
  introspectTable,
  getTableNames,
  getTableColumns,
  getPrimaryKeys,
  getForeignKeys,
  getUniqueConstraints,
  getIndexes,
} from "./core/introspect-schema";
export {
  generateUpMigration,
  generateDownMigration,
  generateCreateTable,
  generateDropTable,
  sortTablesByDependencies,
  columnToSQL,
} from "./core/generate-ddl";
export { createInitialMigration } from "./core/init-migration";

export { createPostgresAdapter } from "./adapters/postgres";
export { migrate } from "./plugins/elysia";
