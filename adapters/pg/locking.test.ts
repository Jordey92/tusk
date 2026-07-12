import { describe, expect, test } from "bun:test";
import type { QueryParam } from "../../types/migrations.js";
import { createLockingMethods } from "./locking";

describe("createLockingMethods", () => {
  test("acquires and releases the advisory lock on the same dedicated client", async () => {
    const calls: Array<{ target: string; sql: string; params?: QueryParam[] }> = [];

    const client = {
      query: async (sql: string, params?: QueryParam[]) => {
        calls.push({ target: "client", sql, params });
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ acquired: true }] };
        }
        return { rows: [{ unlocked: true }] };
      },
      release: () => {
        calls.push({ target: "client", sql: "release" });
      },
    };

    const pool = {
      connect: async () => client,
    };

    const locking = createLockingMethods(pool);

    await locking.acquireMigrationLock();
    await locking.releaseMigrationLock();

    expect(calls).toEqual([
      {
        target: "client",
        sql: "SELECT pg_try_advisory_lock($1) as acquired",
        params: [123456789],
      },
      {
        target: "client",
        sql: "SELECT pg_advisory_unlock($1) AS unlocked",
        params: [123456789],
      },
      {
        target: "client",
        sql: "release",
      },
    ]);
  });

  test("releases the dedicated client when lock acquisition fails", async () => {
    let released = false;

    const client = {
      query: async () => ({ rows: [{ acquired: false }] }),
      release: () => {
        released = true;
      },
    };

    const locking = createLockingMethods({
      connect: async () => client,
    });

    await expect(locking.acquireMigrationLock()).rejects.toThrow(
      "Another migration process is currently running."
    );
    expect(released).toBe(true);
  });

  test("treats release without an acquired lock as a no-op", async () => {
    const locking = createLockingMethods({
      connect: async () => {
        throw new Error("should not connect");
      },
    });

    await expect(locking.releaseMigrationLock()).resolves.toBeUndefined();
  });

  test("rejects a concurrent migration operation on the same adapter", async () => {
    let connections = 0;
    const client = {
      query: async (sql: string) => ({
        rows: sql.includes("pg_try_advisory_lock")
          ? [{ acquired: true }]
          : [{ unlocked: true }],
      }),
      release: () => {},
    };
    const locking = createLockingMethods({
      connect: async () => {
        connections++;
        return client;
      },
    });

    await locking.acquireMigrationLock();
    await expect(locking.acquireMigrationLock()).rejects.toThrow(
      "already running a migration operation"
    );
    expect(connections).toBe(1);
    await locking.releaseMigrationLock();
  });

  test("rejects endpoints that do not retain the advisory lock session", async () => {
    let released = false;
    const client = {
      query: async (sql: string) => ({
        rows: sql.includes("pg_try_advisory_lock")
          ? [{ acquired: true }]
          : [{ unlocked: false }],
      }),
      release: () => {
        released = true;
      },
    };
    const locking = createLockingMethods({
      connect: async () => client,
    });

    await locking.acquireMigrationLock();
    await expect(locking.releaseMigrationLock()).rejects.toThrow(
      "Use a direct or session-pooled PostgreSQL endpoint"
    );
    expect(released).toBe(true);
    expect(locking.getActiveLockClient()).toBeNull();
  });
});
