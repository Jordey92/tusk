import type { StructuredContext } from "./structured.js";
import type { InitMigrationResult } from "../core/init-migration.js";
import type { InitProjectResult } from "../core/init-project.js";
import type { MigrationPlan } from "../core/plan-migrations.js";
import type { ValidationResult } from "../core/validate-migrations.js";
import type { DoctorReport } from "./doctor.js";
import type { DownRunResult, UpRunResult } from "./migrations.js";

export type CliCommand =
  | "create"
  | "init"
  | "up"
  | "down"
  | "status"
  | "validate"
  | "doctor"
  | "version"
  | "help";

export type CliResultPayload<
  TCommand extends CliCommand = CliCommand,
  TData extends object = object,
> = TData & {
  ok: boolean;
  command: TCommand;
};

export interface CliSuccessPayload<TCommand extends CliCommand = CliCommand> {
  ok: true;
  command: TCommand;
}

export interface CliErrorPayload<TCommand extends string = string> {
  ok: false;
  command: TCommand;
  error: {
    code: string;
    message: string;
    cause?: string;
    context?: StructuredContext;
  };
}

interface MigrationFilePayload {
  filename: string;
}

export interface MigrationStatusPayload {
  executed: Array<{
    filename: string;
    executedAt: string | null;
  }>;
  pending: MigrationFilePayload[];
  summary: {
    executed: number;
    pending: number;
  };
}

export type UpMigrationCommandPayload = UpRunResult;

export type DownMigrationCommandPayload = DownRunResult;

export type MigrationCommandPayload<
  TCommand extends "up" | "down" = "up" | "down",
> = TCommand extends "down"
  ? DownMigrationCommandPayload
  : UpMigrationCommandPayload;

export type MigrationCommandJsonPayload<
  TCommand extends "up" | "down",
> = TCommand extends unknown
  ? CliSuccessPayload<TCommand> & MigrationCommandPayload<TCommand>
  : never;

export type MigrationDryRunPayload<
  TDirection extends MigrationPlan["direction"] = MigrationPlan["direction"],
> = {
  dryRun: true;
} & Pick<
  Extract<MigrationPlan, { direction: TDirection }>,
  "direction" | "migrations" | "summary"
>;

export type MigrationDryRunJsonPayload<
  TCommand extends "up" | "down",
> = TCommand extends unknown
  ? CliSuccessPayload<TCommand> & MigrationDryRunPayload<TCommand>
  : never;

export interface MigrationCreatePayload {
  upFile: string;
  downFile: string;
  migrationsPath: string;
}

export type ProjectInitPayload = InitProjectResult;

export interface InitialMigrationPayload extends InitMigrationResult {
  migrationsPath: string;
  fromDb: true;
}

export type MigrationStatusJsonPayload =
  CliSuccessPayload<"status"> & MigrationStatusPayload;

export type MigrationCreateJsonPayload =
  CliSuccessPayload<"create"> & MigrationCreatePayload;

export type ProjectInitJsonPayload =
  CliSuccessPayload<"init"> & ProjectInitPayload;

export type InitialMigrationJsonPayload =
  CliSuccessPayload<"init"> & InitialMigrationPayload;

export type ValidateJsonPayload =
  CliResultPayload<"validate", Omit<ValidationResult, "ok">>;

export type DoctorJsonPayload =
  CliResultPayload<"doctor", DoctorReport>;
