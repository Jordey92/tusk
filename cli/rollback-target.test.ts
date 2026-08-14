import { describe, expect, test } from "bun:test";
import type { ParsedCommandArgs } from "../utils/cli-parser";
import { getCliRollbackTarget } from "./rollback-target";

const baseArgs = (): ParsedCommandArgs => ({
  json: false,
  dryRun: false,
  checkDatabase: false,
  downAll: false,
  allowBaselineRollback: false,
  initFromDb: false,
  status: { exitCode: false, json: false, quiet: false },
});

describe("getCliRollbackTarget", () => {
  test("returns a numeric count when provided", () => {
    expect(
      getCliRollbackTarget({ ...baseArgs(), downCount: "3" })
    ).toBe(3);
  });

  test("defaults to rolling back one migration", () => {
    expect(getCliRollbackTarget(baseArgs())).toBe(1);
  });

  test("builds an all target", () => {
    expect(
      getCliRollbackTarget({ ...baseArgs(), downAll: true })
    ).toEqual({
      all: true,
      allowBaselineRollback: false,
    });
  });

  test("includes baseline override for count rollbacks", () => {
    expect(
      getCliRollbackTarget({
        ...baseArgs(),
        downCount: "1",
        allowBaselineRollback: true,
      })
    ).toEqual({
      count: 1,
      allowBaselineRollback: true,
    });
  });
});
