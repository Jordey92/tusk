import { describe, expect, test } from "bun:test";
import {
  createManagedPostgresAdapter,
  resolvePostgresClientDriver,
} from "./postgres-client";
import { isDriverNotFoundError } from "../utils/errors";
import type {
  ConnectionClient,
  QueryParam,
  QueryResult,
  QueryResultRow,
} from "../types/migrations";
import type { createPostgresJsAdapter } from "./postgresjs";

const missingModule = (specifier: string) => {
  const error = new Error(`Cannot find package '${specifier}' from test`);
  (error as Error & { code: string }).code = "ERR_MODULE_NOT_FOUND";
  return error;
};

const missingImporter = async (specifier: string): Promise<unknown> => {
  throw missingModule(specifier);
};

class FakePool {
  ended = false;

  constructor(readonly config: unknown) {}

  query = async <T extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<T>> => ({
    rows: [],
    rowCount: 0,
  });

  connect = async (): Promise<ConnectionClient> => ({
    query: this.query,
    release: () => {},
  });

  end = async () => {
    this.ended = true;
  };
}

const createFakePostgresSql = () => {
  let ended = false;
  const sql = (() => undefined) as unknown as Parameters<
    typeof createPostgresJsAdapter
  >[0] & {
    ended(): boolean;
  };

  sql.unsafe = async <T extends QueryResultRow>(
    _query: string,
    _params?: QueryParam[]
  ) => Object.assign([] as T[], { count: 0, command: "SELECT" });
  sql.reserve = async () => ({
    unsafe: sql.unsafe,
    release: () => {},
  });
  sql.end = async () => {
    ended = true;
  };
  sql.ended = () => ended;

  return sql;
};

describe("Postgres client resolver", () => {
  test("throws a Tusk-owned error when no supported client is installed", async () => {
    try {
      await resolvePostgresClientDriver({ importModule: missingImporter });
      throw new Error("Expected missing driver error");
    } catch (error) {
      expect(isDriverNotFoundError(error)).toBe(true);
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("No supported Postgres client found")
      );
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("bun add pg")
      );
    }
  });

  test("uses pg when the Pool constructor is available", async () => {
    const pools: FakePool[] = [];
    const FakePoolConstructor = class extends FakePool {
      constructor(config: unknown) {
        super(config);
        pools.push(this);
      }
    };

    const managed = await createManagedPostgresAdapter(
      {
        connectionString: "postgres://localhost/tusk",
        driver: "pg",
        statementTimeoutMs: 0,
      },
      {
        importModule: async (specifier) => {
          if (specifier === "pg") {
            return { Pool: FakePoolConstructor };
          }

          throw missingModule(specifier);
        },
      }
    );

    expect(managed.driver).toBe("pg");
    expect(pools[0]?.config).toEqual({
      connectionString: "postgres://localhost/tusk",
    });

    await managed.cleanup();
    expect(pools[0]?.ended).toBe(true);
  });

  test("falls back to postgres when pg is not installed", async () => {
    const clients: ReturnType<typeof createFakePostgresSql>[] = [];

    const managed = await createManagedPostgresAdapter(
      {
        host: "127.0.0.1",
        port: 5432,
        database: "tusk",
        user: "postgres",
        password: "postgres",
      },
      {
        importModule: async (specifier) => {
          if (specifier === "pg") {
            throw missingModule(specifier);
          }

          if (specifier === "postgres") {
            return {
              default: (options: Record<string, unknown>) => {
                const sql = createFakePostgresSql();
                clients.push(sql);
                expect(options).toMatchObject({
                  host: "127.0.0.1",
                  port: 5432,
                  database: "tusk",
                  user: "postgres",
                  password: "postgres",
                });
                return sql;
              },
            };
          }

          throw missingModule(specifier);
        },
      }
    );

    expect(managed.driver).toBe("postgres");
    expect(clients).toHaveLength(1);

    await managed.cleanup();
    expect(clients[0]?.ended()).toBe(true);
  });

  test("honors an explicit postgres.js driver when both clients are installed", async () => {
    const sql = createFakePostgresSql();
    const managed = await createManagedPostgresAdapter(
      {
        connectionString: "postgres://localhost/tusk",
        driver: "postgres",
      },
      {
        importModule: async (specifier) => {
          if (specifier === "pg") return { Pool: FakePool };
          if (specifier === "postgres") return { default: () => sql };
          throw missingModule(specifier);
        },
      }
    );

    expect(managed.driver).toBe("postgres");
    await managed.cleanup();
  });
});
