import type { DatabaseAdapter } from "../../types/migrations.js";
import type {
  DoctorDatabaseConfiguration,
} from "../../types/doctor.js";

export type DoctorDatabaseInput =
  | {
      state: "not_configured";
      error?: unknown;
    }
  | {
      state: "configured";
      adapter: DatabaseAdapter;
    }
  | {
      state: "connection_failed";
      error: unknown;
    }
  | {
      state: "driver_missing";
      configuration: DoctorDatabaseConfiguration;
      error: unknown;
    };

export type MigrationsPathState =
  | {
      state: "exists";
      path: string;
    }
  | {
      state: "missing";
      path: string;
    };

export interface RunDoctorOptions {
  migrationsPath: string;
  tuskVersion: string;
  database: DoctorDatabaseInput;
}
