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

export type DoctorResult = "pass" | "fail";
export type DoctorDatabaseConfiguration = "found" | "missing";

export interface DoctorMigrationTableIssue {
  code: string;
  message: string;
  column?: string;
  expected?: string;
  actual?: string;
}

export type DoctorMigrationTable =
  | {
      state: "missing";
    }
  | {
      state: "ready";
      checksumState: "enabled";
    }
  | {
      state: "legacy_missing_checksum_column";
      checksumState: "limited";
    }
  | {
      state: "invalid_shape";
      issues: DoctorMigrationTableIssue[];
    };

export type DoctorDatabaseEngine =
  | {
      state: "supported";
      engine: "postgresql";
      provider: "postgresql" | "aurora-postgresql";
      serverVersion: string;
      majorVersion: number;
      rawVersion: string;
    }
  | {
      state: "unsupported";
      engine: "postgresql";
      provider: "postgresql";
      reason: "version_unknown" | "version_below_floor";
      supportedFloor: number;
      rawVersion: string;
      serverVersion?: string;
      majorVersion?: number;
    }
  | {
      state: "unsupported";
      engine: "postgresql";
      provider: "redshift" | "unknown";
      reason: "unsupported_provider";
      rawVersion: string;
    };

export type DoctorMigrationStatus =
  | {
      state: "readable";
      executed: number;
      pending: number;
    }
  | {
      state: "skipped";
      reason: "missing_migrations_path" | "unsafe_migration_state";
    }
  | {
      state: "unreadable";
      cause: string;
    };

export type DoctorDatabase =
  | {
      state: "not_configured";
    }
  | {
      state: "driver_missing";
      configuration: DoctorDatabaseConfiguration;
    }
  | {
      state: "connection_failed";
      configuration: "found";
    }
  | {
      state: "connected";
      engine: DoctorDatabaseEngine;
      migrationTable?: DoctorMigrationTable;
      migrationStatus?: DoctorMigrationStatus;
    };

interface DoctorEnvironment {
  tuskVersion: string;
  migrationsPath: string;
  databaseConfiguration: DoctorDatabaseConfiguration;
}

export interface DoctorReport {
  result: DoctorResult;
  summary: DoctorSummary;
  environment: DoctorEnvironment;
  database: DoctorDatabase;
  checks: DoctorCheck[];
}
