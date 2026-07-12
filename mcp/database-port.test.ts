import { describe, expect, test } from "bun:test";
import { parseDatabasePort } from "./database-port";

describe("database port parsing", () => {
  test("uses the default for omitted or blank ports", () => {
    expect(parseDatabasePort()).toBe(5432);
    expect(parseDatabasePort("")).toBe(5432);
  });

  test("accepts TCP port boundaries", () => {
    expect(parseDatabasePort("1")).toBe(1);
    expect(parseDatabasePort("65535")).toBe(65535);
  });

  test("rejects malformed and out-of-range ports", () => {
    for (const port of ["not-a-port", "0", "65536", "1.5"]) {
      expect(() => parseDatabasePort(port)).toThrow(
        "DB_PORT must be an integer between 1 and 65535",
      );
    }
  });
});
