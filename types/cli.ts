import type { StructuredContext } from "./structured.js";
import type { InitMigrationResult } from "../core/init-migration.js";
import type { InitProjectResult } from "../core/init-project.js";
import type { RunResult } from "./migrations.js";

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

export interface CliSuccessPayload {
  ok: true;
  command: CliCommand;
}

export interface CliErrorPayload {
  ok: false;
  command?: string;
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

export type MigrationCommandPayload = RunResult;

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
