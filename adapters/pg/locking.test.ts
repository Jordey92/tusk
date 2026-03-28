import { describe, expect, test } from "bun:test";
import { createLockingMethods } from "./locking";

describe("createLockingMethods", () => {
  test("acquires and releases the advisory lock on the same dedicated client", async () => {
    const calls: Array<{ target: string; sql: string; params?: unknown[] }> = [];

    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ target: "client", sql, params });
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ acquired: true }] };
        }
        return { rows: [] };
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
        sql: "SELECT pg_advisory_unlock($1)",
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
});
