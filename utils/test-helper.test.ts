import { describe, expect, test } from "bun:test";
import { parseTestDatabasePort } from "./test-helper";

describe("test database configuration", () => {
  test("defaults omitted or blank test database ports and accepts TCP boundaries", () => {
    expect(parseTestDatabasePort()).toBe(5433);
    expect(parseTestDatabasePort("")).toBe(5433);
    expect(parseTestDatabasePort("1")).toBe(1);
    expect(parseTestDatabasePort("65535")).toBe(65535);
  });

  test("rejects invalid and out-of-range test database ports", () => {
    for (const port of ["not-a-port", "0", "65536", "1.5"]) {
      expect(() => parseTestDatabasePort(port)).toThrow(
        "TUSK_TEST_DB_PORT must be an integer between 1 and 65535"
      );
    }
  });
});
