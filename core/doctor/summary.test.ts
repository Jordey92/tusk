import { describe, expect, test } from "bun:test";
import type { DoctorCheck } from "../../types/doctor";
import { createSummary, getDoctorResult } from "./summary";

describe("createSummary", () => {
  test("counts each check status", () => {
    const checks: DoctorCheck[] = [
      { id: "a", status: "pass", message: "ok" },
      { id: "b", status: "warn", message: "warn" },
      { id: "c", status: "fail", message: "fail" },
      { id: "d", status: "skip", message: "skip" },
      { id: "e", status: "pass", message: "ok again" },
    ];

    expect(createSummary(checks)).toEqual({
      passed: 2,
      warnings: 1,
      errors: 1,
      skipped: 1,
    });
  });
});

describe("getDoctorResult", () => {
  test("fails when any check errored", () => {
    expect(
      getDoctorResult({ passed: 1, warnings: 0, errors: 1, skipped: 0 })
    ).toBe("fail");
    expect(
      getDoctorResult({ passed: 1, warnings: 2, errors: 0, skipped: 0 })
    ).toBe("pass");
  });
});
