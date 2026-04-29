export type {
  ConnectionConfig,
  DatabaseAdapter,
  Migration,
  MigrationRecord,
  QueryResult,
  RunResult,
  TransactionClient,
} from "./types/migrations.js";
export type { ElysiaMigrateConfig } from "./plugins/elysia.js";
export type {
  ManagedPostgresAdapter,
  PostgresClientConfig,
  SupportedPostgresDriver,
} from "./adapters/postgres-client.js";
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
  MigrationTableShapeIssue,
  MigrationTableState,
} from "./core/migration-records.js";
export type {
  DownMigrationState,
  UpMigrationState,
} from "./core/migration-resolution.js";
export type {
  NormalizedRollbackTarget,
  RollbackTarget,
} from "./core/rollback-target.js";
export type {
  ValidationIssue,
  ValidationResult,
  ValidationSeverity,
  ValidateMigrationsOptions,
} from "./core/validate-migrations.js";
export type { InitMigrationResult } from "./core/init-migration.js";
export type { InitProjectResult } from "./core/init-project.js";
export type {
  CliErrorPayload,
  CliSuccessPayload,
  InitialMigrationPayload,
  MigrationCommandPayload,
  MigrationCreatePayload,
  ProjectInitPayload,
  MigrationStatusPayload,
} from "./types/cli.js";
export type {
  DoctorCheck,
  DoctorDatabase,
  DoctorDatabaseConfiguration,
  DoctorDatabaseEngine,
  DoctorMigrationStatus,
  DoctorMigrationTable,
  DoctorMigrationTableIssue,
  DoctorReport,
  DoctorResult,
  DoctorSummary,
} from "./types/doctor.js";

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
export { initializeProject } from "./core/init-project.js";

export { createPgAdapter } from "./adapters/pg.js";
export { createPostgresJsAdapter } from "./adapters/postgresjs.js";
export { migrate } from "./plugins/elysia.js";
