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
});
