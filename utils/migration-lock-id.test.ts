import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MIGRATION_LOCK_ID,
  deriveMigrationLockId,
  parseMigrationLockId,
  resolveConfiguredMigrationLock,
  resolveMigrationLockId,
} from "./migration-lock-id";

describe("deriveMigrationLockId", () => {
  test("returns a positive integer in the signed 31-bit range", () => {
    const id = deriveMigrationLockId("tusk");
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(1);
    expect(id).toBeLessThanOrEqual(2_147_483_647);
  });

  test("is stable for the same seed", () => {
    expect(deriveMigrationLockId("/app/migrations")).toBe(
      deriveMigrationLockId("/app/migrations"),
    );
  });

  test("differs for different seeds", () => {
    expect(deriveMigrationLockId("/app/a/migrations")).not.toBe(
      deriveMigrationLockId("/app/b/migrations"),
    );
  });

  test("trims whitespace before hashing", () => {
    expect(deriveMigrationLockId("  project  ")).toBe(deriveMigrationLockId("project"));
  });

  test("rejects empty seeds", () => {
    expect(() => deriveMigrationLockId("")).toThrow(/non-empty/);
    expect(() => deriveMigrationLockId("   ")).toThrow(/non-empty/);
  });
});

describe("parseMigrationLockId", () => {
  test("accepts integers in range", () => {
    expect(parseMigrationLockId(42)).toBe(42);
    expect(parseMigrationLockId("42")).toBe(42);
    expect(parseMigrationLockId(" 99 ")).toBe(99);
  });

  test("rejects out-of-range and non-integer values", () => {
    expect(() => parseMigrationLockId(0)).toThrow(/Invalid migrationLockId/);
    expect(() => parseMigrationLockId(-1)).toThrow(/Invalid migrationLockId/);
    expect(() => parseMigrationLockId(2_147_483_648)).toThrow(/Invalid migrationLockId/);
    expect(() => parseMigrationLockId(1.5)).toThrow(/Invalid migrationLockId/);
    expect(() => parseMigrationLockId("abc")).toThrow(/Invalid migrationLockId/);
  });
});

describe("resolveMigrationLockId", () => {
  test("uses explicit lockId when provided", () => {
    expect(resolveMigrationLockId({ lockId: 999, seed: "ignored" })).toBe(999);
    expect(resolveMigrationLockId({ lockId: "888" })).toBe(888);
  });

  test("derives from seed when lockId is omitted", () => {
    expect(resolveMigrationLockId({ seed: "my-app" })).toBe(
      deriveMigrationLockId("my-app"),
    );
  });

  test("falls back to the stable library default", () => {
    expect(resolveMigrationLockId()).toBe(DEFAULT_MIGRATION_LOCK_ID);
    expect(DEFAULT_MIGRATION_LOCK_ID).toBe(123456789);
  });
});

describe("resolveConfiguredMigrationLock", () => {
  test("prefers an explicit env lock id", () => {
    expect(
      resolveConfiguredMigrationLock({
        lockIdEnv: "4242",
        seedEnv: "ignored",
        migrationsPath: "./migrations",
      }),
    ).toEqual({ migrationLockId: 4242 });
  });

  test("CLI-derived lock for ./migrations matches the programmatic default", () => {
    const configured = resolveConfiguredMigrationLock({
      migrationsPath: "./migrations",
    });
    const cli = resolveMigrationLockId({
      lockId: configured.migrationLockId,
      seed: configured.migrationLockSeed,
    });

    expect(cli).toBe(DEFAULT_MIGRATION_LOCK_ID);
  });

  test("opts into derivation only when a seed is provided", () => {
    expect(
      resolveConfiguredMigrationLock({ seedEnv: "billing-service" }),
    ).toEqual({ migrationLockSeed: "billing-service" });
    expect(
      resolveConfiguredMigrationLock({ seed: "billing-service" }),
    ).toEqual({ migrationLockSeed: "billing-service" });
  });

  test("returns empty options when nothing is configured", () => {
    expect(resolveConfiguredMigrationLock()).toEqual({});
    expect(resolveConfiguredMigrationLock({ lockIdEnv: "" })).toEqual({});
    expect(resolveConfiguredMigrationLock({ seedEnv: "" })).toEqual({});
  });
});
