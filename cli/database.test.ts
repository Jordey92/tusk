import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter } from "../types/migrations";
import {
  createDatabaseConnection,
  createDoctorDatabaseInput,
  type DatabaseModuleDeps,
} from "./database";

const adapter = { id: "adapter" } as unknown as DatabaseAdapter;

const baseDeps = (): DatabaseModuleDeps => ({
  resolvePostgresClientDriver: async () => "pg",
  createManagedPostgresAdapter: async () => ({
    driver: "pg",
    adapter,
    cleanup: async () => {},
  }),
  loadDatabaseConfig: () => ({
    connectionString: "postgresql://user:password@localhost:5432/app",
  }),
  loadDriverPreference: () => undefined,
});

describe("createDatabaseConnection", () => {
  test("builds an adapter from the loaded config", async () => {
    const deps = baseDeps();
    let seenConfig: unknown;
    let seenLoadOptions: unknown;
    deps.loadDatabaseConfig = (options) => {
      seenLoadOptions = options;
      return {
        connectionString: "postgresql://user:password@localhost:5432/app",
        migrationLockSeed: "/resolved/migrations",
      };
    };
    deps.createManagedPostgresAdapter = async (config) => {
      seenConfig = config;
      return {
        driver: "pg",
        adapter,
        cleanup: async () => {},
      };
    };

    const managed = await createDatabaseConnection(
      { migrationsPath: "./migrations" },
      deps
    );
    expect(seenLoadOptions).toEqual({ migrationsPath: "./migrations" });
    expect(seenConfig).toEqual({
      connectionString: "postgresql://user:password@localhost:5432/app",
      migrationLockSeed: "/resolved/migrations",
    });
    expect(managed.adapter).toBe(adapter);
  });
});

describe("createDoctorDatabaseInput", () => {
  test("reports configured when the driver and adapter are available", async () => {
    const result = await createDoctorDatabaseInput({}, baseDeps());
    expect(result.database).toEqual({
      state: "configured",
      adapter,
    });
    await result.cleanup();
  });

  test("reports driver_missing with found config when only the driver is missing", async () => {
    const driverError = new Error("driver missing");
    const result = await createDoctorDatabaseInput(
      {},
      {
        ...baseDeps(),
        resolvePostgresClientDriver: async () => {
          throw driverError;
        },
      }
    );

    expect(result.database).toEqual({
      state: "driver_missing",
      configuration: "found",
      error: driverError,
    });
  });

  test("reports driver_missing with missing config when config also fails", async () => {
    const driverError = new Error("driver missing");
    const result = await createDoctorDatabaseInput(
      {},
      {
        ...baseDeps(),
        resolvePostgresClientDriver: async () => {
          throw driverError;
        },
        loadDatabaseConfig: () => {
          throw new Error("config missing");
        },
      }
    );

    expect(result.database).toEqual({
      state: "driver_missing",
      configuration: "missing",
      error: driverError,
    });
  });

  test("reports not_configured when config cannot be loaded", async () => {
    const configError = new Error("config missing");
    const result = await createDoctorDatabaseInput(
      {},
      {
        ...baseDeps(),
        loadDatabaseConfig: () => {
          throw configError;
        },
      }
    );

    expect(result.database).toEqual({
      state: "not_configured",
      error: configError,
    });
  });

  test("reports connection_failed when adapter creation fails", async () => {
    const connectionError = new Error("cannot connect");
    const result = await createDoctorDatabaseInput(
      {},
      {
        ...baseDeps(),
        createManagedPostgresAdapter: async () => {
          throw connectionError;
        },
      }
    );

    expect(result.database).toEqual({
      state: "connection_failed",
      error: connectionError,
    });
  });

  test("passes the preferred driver into driver resolution", async () => {
    let preferredDriver: unknown;
    await createDoctorDatabaseInput(
      {},
      {
        ...baseDeps(),
        loadDriverPreference: () => "postgres",
        resolvePostgresClientDriver: async (options) => {
          preferredDriver = options.preferredDriver;
          return "postgres";
        },
      }
    );

    expect(preferredDriver).toBe("postgres");
  });

  test("forwards migrationsPath into database config loading", async () => {
    let seenLoadOptions: unknown;
    await createDoctorDatabaseInput(
      { migrationsPath: "/apps/a/migrations" },
      {
        ...baseDeps(),
        loadDatabaseConfig: (options) => {
          seenLoadOptions = options;
          return {
            connectionString: "postgresql://user:password@localhost:5432/app",
          };
        },
      }
    );

    expect(seenLoadOptions).toEqual({
      migrationsPath: "/apps/a/migrations",
    });
  });
});
