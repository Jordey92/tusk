import {
  createManagedPostgresAdapter,
  resolvePostgresClientDriver,
  type ManagedPostgresAdapter,
} from "../adapters/postgres-client.js";
import { loadDatabaseConfig, loadDriverPreference } from "./config.js";
import type { TuskProjectFileConfig } from "./project-config.js";

export interface DatabaseModuleDeps {
  resolvePostgresClientDriver: typeof resolvePostgresClientDriver;
  createManagedPostgresAdapter: typeof createManagedPostgresAdapter;
  loadDatabaseConfig: typeof loadDatabaseConfig;
  loadDriverPreference: typeof loadDriverPreference;
}

type DatabaseConnectionOptions = {
  migrationsPath?: string;
  projectConfig?: TuskProjectFileConfig;
};

const defaultDeps: DatabaseModuleDeps = {
  resolvePostgresClientDriver,
  createManagedPostgresAdapter,
  loadDatabaseConfig,
  loadDriverPreference,
};

export const createDatabaseConnection = async (
  options: DatabaseConnectionOptions = {},
  deps: Pick<
    DatabaseModuleDeps,
    "createManagedPostgresAdapter" | "loadDatabaseConfig"
  > = defaultDeps
): Promise<ManagedPostgresAdapter> => {
  const config = deps.loadDatabaseConfig(options);
  return deps.createManagedPostgresAdapter(config);
};

const createDriverNotFoundDoctorInput = (
  error: unknown,
  loadConfig: DatabaseModuleDeps["loadDatabaseConfig"],
  options: DatabaseConnectionOptions = {}
) => {
  try {
    loadConfig(options);
    return {
      database: {
        state: "driver_missing" as const,
        configuration: "found" as const,
        error,
      },
      cleanup: async () => {},
    };
  } catch {
    return {
      database: {
        state: "driver_missing" as const,
        configuration: "missing" as const,
        error,
      },
      cleanup: async () => {},
    };
  }
};

export const createDoctorDatabaseInput = async (
  options: DatabaseConnectionOptions = {},
  deps: DatabaseModuleDeps = defaultDeps
) => {
  try {
    await deps.resolvePostgresClientDriver({
      preferredDriver: deps.loadDriverPreference(options.projectConfig?.driver),
    });
  } catch (error) {
    return createDriverNotFoundDoctorInput(
      error,
      deps.loadDatabaseConfig,
      options
    );
  }

  let config;

  try {
    config = deps.loadDatabaseConfig(options);
  } catch (error) {
    return {
      database: {
        state: "not_configured" as const,
        error,
      },
      cleanup: async () => {},
    };
  }

  try {
    const database = await deps.createManagedPostgresAdapter(config);
    return {
      database: {
        state: "configured" as const,
        adapter: database.adapter,
      },
      cleanup: database.cleanup,
    };
  } catch (error) {
    return {
      database: {
        state: "connection_failed" as const,
        error,
      },
      cleanup: async () => {},
    };
  }
};
