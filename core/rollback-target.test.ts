import { describe, expect, test } from "bun:test";
import { normalizeRollbackTarget } from "./rollback-target";

describe("rollback target", () => {
  test("defaults to one rollback", () => {
    expect(normalizeRollbackTarget()).toEqual({
      mode: "count",
      count: 1,
      requestedCount: 1,
      allowBaselineRollback: false,
    });
  });

  test("preserves explicit counts and all-history selection", () => {
    expect(normalizeRollbackTarget(2)).toEqual({
      mode: "count",
      count: 2,
      requestedCount: 2,
      allowBaselineRollback: false,
    });
    expect(normalizeRollbackTarget({ all: true })).toEqual({
      mode: "all",
      allowBaselineRollback: false,
    });
    expect(normalizeRollbackTarget({ allowBaselineRollback: true })).toEqual({
      mode: "count",
      count: 1,
      requestedCount: 1,
      allowBaselineRollback: true,
    });
  });

  test("rejects invalid counts", () => {
    expect(() => normalizeRollbackTarget(0)).toThrow(
      "Rollback count must be a positive integer"
    );
    expect(() => normalizeRollbackTarget(-1)).toThrow(
      "Rollback count must be a positive integer"
    );
  });

  test("rejects contradictory all and count targets", () => {
    expect(() => normalizeRollbackTarget({ all: true, count: 1 })).toThrow(
      "Rollback target cannot combine all with a count"
    );
  });
});
