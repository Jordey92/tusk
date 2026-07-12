export type {
  ConnectionConfig,
  ConnectionClient,
  ConnectionPool,
  DatabaseAdapter,
  DatabaseAdapterOptions,
  DownRunResult,
  MigrationRunResult,
  MigrationAdapter,
  Migration,
  MigrationRecord,
  QueryResult,
  QueryClient,
  QueryParam,
  QueryResultRow,
  RollbackTargetPayload,
  RunResult,
  TransactionClient,
  UpRunResult,
} from "./types/migrations.js";
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
  UpMigrationPlan,
  UpMigrationPlanEntry,
  DownMigrationPlan,
  DownMigrationPlanEntry,
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
  CliCommand,
  CliErrorPayload,
  CliResultPayload,
  CliSuccessPayload,
  DoctorJsonPayload,
  InitialMigrationPayload,
  InitialMigrationJsonPayload,
  DownMigrationCommandPayload,
  MigrationCommandPayload,
  MigrationCommandJsonPayload,
  MigrationCreatePayload,
  MigrationCreateJsonPayload,
  MigrationDryRunJsonPayload,
  MigrationDryRunPayload,
  ProjectInitPayload,
  ProjectInitJsonPayload,
  MigrationStatusPayload,
  MigrationStatusJsonPayload,
  UpMigrationCommandPayload,
  ValidateJsonPayload,
} from "./types/cli.js";
export type {
  DoctorCheck,
  DoctorCheckStatus,
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
export type { StructuredContext, StructuredValue } from "./types/structured.js";
export type { TuskErrorCode } from "./utils/errors.js";

export { TuskError, createTuskError, isTuskError } from "./utils/errors.js";
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
