import {
  createManagedPostgresAdapter,
  resolvePostgresClientDriver,
  type ManagedPostgresAdapter,
} from "../adapters/postgres-client.js";
import { loadDatabaseConfig, loadDriverPreference } from "./config.js";

export const createDatabaseConnection = async (): Promise<ManagedPostgresAdapter> => {
  const config = loadDatabaseConfig();
  return createManagedPostgresAdapter(config);
};

const createDriverNotFoundDoctorInput = (error: unknown) => {
  try {
    loadDatabaseConfig();
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

export const createDoctorDatabaseInput = async () => {
  try {
    await resolvePostgresClientDriver({
      preferredDriver: loadDriverPreference(),
    });
  } catch (error) {
    return createDriverNotFoundDoctorInput(error);
  }

  let config;

  try {
    config = loadDatabaseConfig();
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
    const database = await createManagedPostgresAdapter(config);
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
