import type { StructuredContext } from "./structured.js";

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

export interface MigrationCommandPayload {
  executed: number;
  pending: number;
  requestedCount?: number;
  availableRollbackCount?: number;
  rollbackAll?: boolean;
}

export interface MigrationCreatePayload {
  upFile: string;
  downFile: string;
  migrationsPath: string;
}

export interface InitialMigrationPayload {
  upFile: string;
  downFile: string;
  tableCount: number;
  checksum: string;
  markedAsExecuted: boolean;
  migrationsPath: string;
}
