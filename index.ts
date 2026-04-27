export type {
  DatabaseAdapter,
  TransactionClient,
  QueryResult,
  Migration,
  MigrationRecord,
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
export type {
  MigrationPlan,
  MigrationPlanDirection,
  MigrationPlanEntry,
} from "./core/plan-migrations.js";
export type {
  ValidationIssue,
  ValidationResult,
  ValidationSeverity,
  ValidateMigrationsOptions,
} from "./core/validate-migrations.js";
export type {
  CliErrorPayload,
  CliSuccessPayload,
  MigrationCommandPayload,
  MigrationCreatePayload,
  InitialMigrationPayload,
  MigrationStatusPayload,
} from "./types/cli.js";

export { runUp, runDown } from "./core/run-migrations.js";
export { readMigrations } from "./core/read-migrations.js";
export { createUpPlan, createDownPlan } from "./core/plan-migrations.js";
export { validateMigrations } from "./core/validate-migrations.js";
export { getMigrationStatus } from "./core/migration-status.js";
export {
  ensureMigrationsTable,
  getExecutedMigrations,
  getLastExecutedMigrations,
} from "./core/track-migrations.js";
export { createInitialMigration } from "./core/init-migration.js";

export { createPgAdapter } from "./adapters/pg.js";
export { createPostgresJsAdapter } from "./adapters/postgresjs.js";
export { migrate } from "./plugins/elysia.js";
