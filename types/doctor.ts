import type { StructuredContext } from "./structured.js";

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  context?: StructuredContext;
}

export interface DoctorSummary {
  passed: number;
  warnings: number;
  errors: number;
  skipped: number;
}

interface DoctorEnvironment {
  tuskVersion: string;
  migrationsPath: string;
  databaseConfigured: boolean;
}

export interface DoctorDatabase {
  configured: boolean;
  connected: boolean;
  engine?: string;
  provider?: string;
  serverVersion?: string;
  supported?: boolean;
  migrationTable?: {
    exists: boolean;
    hasChecksum: boolean;
  };
  status?: {
    executed: number;
    pending: number;
  };
}

export interface DoctorReport {
  ok: boolean;
  summary: DoctorSummary;
  environment: DoctorEnvironment;
  database: DoctorDatabase;
  checks: DoctorCheck[];
}
