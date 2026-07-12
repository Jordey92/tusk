import { describe, expect, test } from "bun:test";
import type {
  ConnectionClient,
  ConnectionPool,
  QueryParam,
  QueryResult,
  QueryResultRow,
} from "../../types/migrations.js";
import { createExecuteQuery, createTransaction } from "./query";

const result = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
  rows,
  rowCount: rows.length,
});

describe("createExecuteQuery", () => {
  test("forwards SQL and parameters to the pool", async () => {
    const calls: Array<{ sql: string; params?: QueryParam[] }> = [];
    const pool = {
      query: async <T extends QueryResultRow = QueryResultRow>(
        sql: string,
        params?: QueryParam[]
      ) => {
        calls.push({ sql, params });
        return result([{ value: 1 }] as T[]);
      },
    };

    const query = createExecuteQuery(pool);
    const queryResult = await query<{ value: number }>(
      "SELECT $1::int AS value",
      [1]
    );

    expect(calls).toEqual([{ sql: "SELECT $1::int AS value", params: [1] }]);
    expect(queryResult.rows).toEqual([{ value: 1 }]);
  });

  test("uses the lock-owning client when one is active", async () => {
    const targets: string[] = [];
    const activeClient = {
      query: async <T extends QueryResultRow = QueryResultRow>() => {
        targets.push("lock-client");
        return result([] as T[]);
      },
      release: () => {},
    };
    const pool = {
      query: async <T extends QueryResultRow = QueryResultRow>() => {
        targets.push("pool");
        return result([] as T[]);
      },
    };

    await createExecuteQuery(pool, () => activeClient)("SELECT 1");
    expect(targets).toEqual(["lock-client"]);
  });

  test("serializes concurrent queries on the lock-owning client", async () => {
    let activeQueries = 0;
    let maximumActiveQueries = 0;
    const calls: string[] = [];
    const activeClient: ConnectionClient = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string) => {
        activeQueries++;
        maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
        calls.push(sql);
        await Bun.sleep(1);
        activeQueries--;
        return result([] as T[]);
      },
      release: () => {},
    };
    const pool = {
      query: async <T extends QueryResultRow = QueryResultRow>() =>
        result([] as T[]),
    };
    const query = createExecuteQuery(pool, () => activeClient);

    await Promise.all([query("SELECT 1"), query("SELECT 2"), query("SELECT 3")]);

    expect(maximumActiveQueries).toBe(1);
    expect(calls).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
  });
});

describe("createTransaction", () => {
  test("begins, commits, and releases a successful transaction", async () => {
    const calls: string[] = [];
    const client: ConnectionClient = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string) => {
        calls.push(sql);
        return result([] as T[]);
      },
      release: () => {
        calls.push("release");
      },
    };
    const pool: ConnectionPool = {
      connect: async () => client,
      query: async <T extends QueryResultRow = QueryResultRow>() =>
        result([] as T[]),
    };

    const transaction = createTransaction(pool);
    const value = await transaction(async (tx) => {
      await tx.query("SELECT 1");
      return "done";
    });

    expect(value).toBe("done");
    expect(calls).toEqual([
      "BEGIN",
      "SET LOCAL statement_timeout = '300000'",
      "SELECT 1",
      "COMMIT",
      "release",
    ]);
  });

  test("rolls back and releases when the callback fails", async () => {
    const calls: string[] = [];
    const client: ConnectionClient = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string) => {
        calls.push(sql);
        return result([] as T[]);
      },
      release: () => {
        calls.push("release");
      },
    };
    const pool: ConnectionPool = {
      connect: async () => client,
      query: async <T extends QueryResultRow = QueryResultRow>() =>
        result([] as T[]),
    };

    const transaction = createTransaction(pool);

    await expect(
      transaction(async () => {
        throw new Error("callback failed");
      })
    ).rejects.toThrow("callback failed");

    expect(calls).toEqual([
      "BEGIN",
      "SET LOCAL statement_timeout = '300000'",
      "ROLLBACK",
      "release",
    ]);
  });

  test("releases without rollback when the transaction never starts", async () => {
    const calls: string[] = [];
    const client: ConnectionClient = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string) => {
        calls.push(sql);
        if (sql === "BEGIN") {
          throw new Error("begin failed");
        }
        return result([] as T[]);
      },
      release: () => {
        calls.push("release");
      },
    };
    const pool: ConnectionPool = {
      connect: async () => client,
      query: async <T extends QueryResultRow = QueryResultRow>() =>
        result([] as T[]),
    };

    const transaction = createTransaction(pool);

    await expect(transaction(async () => "unreachable")).rejects.toThrow(
      "begin failed"
    );
    expect(calls).toEqual(["BEGIN", "release"]);
  });

  test("reuses the lock-owning connection and supports a one-connection pool", async () => {
    const calls: string[] = [];
    const client: ConnectionClient = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string) => {
        calls.push(sql);
        return result([] as T[]);
      },
      release: () => calls.push("release"),
    };
    const pool: ConnectionPool = {
      connect: async () => {
        throw new Error("a second connection must not be requested");
      },
      query: async <T extends QueryResultRow = QueryResultRow>() =>
        result([] as T[]),
    };

    const transaction = createTransaction(pool, () => client, {
      statementTimeoutMs: 0,
    });
    await transaction(async (tx) => {
      await tx.query("SELECT 1");
    });

    expect(calls).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
  });

  test("rejects invalid statement timeout configuration", () => {
    const pool = {
      connect: async () => {
        throw new Error("not used");
      },
      query: async <T extends QueryResultRow = QueryResultRow>() =>
        result([] as T[]),
    };

    expect(() => createTransaction(pool, () => null, {
      statementTimeoutMs: -1,
    })).toThrow("statementTimeoutMs must be a non-negative safe integer");
  });
});
