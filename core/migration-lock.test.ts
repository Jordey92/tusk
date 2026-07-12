import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter } from "../types/migrations";
import { withMigrationLock } from "./migration-lock";

const adapterWithRelease = (releaseMigrationLock: () => Promise<void>) => ({
  acquireMigrationLock: async () => {},
  releaseMigrationLock,
}) as DatabaseAdapter;

describe("withMigrationLock", () => {
  test("preserves the operation error when lock release also fails", async () => {
    const operationError = new Error("migration failed");
    const adapter = adapterWithRelease(async () => {
      throw new Error("unlock failed");
    });

    await expect(
      withMigrationLock(adapter, "test", async () => {
        throw operationError;
      })
    ).rejects.toBe(operationError);
  });

  test("reports lock release failure after a successful operation", async () => {
    const adapter = adapterWithRelease(async () => {
      throw new Error("unlock failed");
    });

    await expect(
      withMigrationLock(adapter, "test", async () => "done")
    ).rejects.toThrow("unlock failed");
  });
});
