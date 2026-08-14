import {
  createManagedPostgresAdapter,
  resolvePostgresClientDriver,
  type ManagedPostgresAdapter,
} from "../adapters/postgres-client.js";
import { loadDatabaseConfig, loadDriverPreference } from "./config.js";

export interface DatabaseModuleDeps {
  resolvePostgresClientDriver: typeof resolvePostgresClientDriver;
  createManagedPostgresAdapter: typeof createManagedPostgresAdapter;
  loadDatabaseConfig: typeof loadDatabaseConfig;
  loadDriverPreference: typeof loadDriverPreference;
}

export type DatabaseConnectionOptions = {
  migrationsPath?: string;
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
  const config = deps.loadDatabaseConfig({
    migrationsPath: options.migrationsPath,
  });
  return deps.createManagedPostgresAdapter(config);
};

const createDriverNotFoundDoctorInput = (
  error: unknown,
  loadConfig: DatabaseModuleDeps["loadDatabaseConfig"],
  migrationsPath?: string
) => {
  try {
    loadConfig({ migrationsPath });
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
      preferredDriver: deps.loadDriverPreference(),
    });
  } catch (error) {
    return createDriverNotFoundDoctorInput(
      error,
      deps.loadDatabaseConfig,
      options.migrationsPath
    );
  }

  let config;

  try {
    config = deps.loadDatabaseConfig({
      migrationsPath: options.migrationsPath,
    });
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
