import type {
  DoctorCheck,
  DoctorCheckStatus,
  DoctorDatabaseConfiguration,
  DoctorSummary,
} from "../../types/doctor.js";
import type { DoctorDatabaseInput } from "./types.js";

const statusCounts: Record<DoctorCheckStatus, keyof DoctorSummary> = {
  pass: "passed",
  warn: "warnings",
  fail: "errors",
  skip: "skipped",
};

export const createSummary = (checks: DoctorCheck[]): DoctorSummary => {
  const summary: DoctorSummary = {
    passed: 0,
    warnings: 0,
    errors: 0,
    skipped: 0,
  };

  for (const check of checks) {
    summary[statusCounts[check.status]]++;
  }

  return summary;
};

export const addCheck = (checks: DoctorCheck[], check: DoctorCheck) => {
  checks.push(check);
};

export const formatError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const getDoctorResult = (summary: DoctorSummary) =>
  summary.errors === 0 ? "pass" : "fail";

export const getDatabaseConfiguration = (
  input: DoctorDatabaseInput
): DoctorDatabaseConfiguration => {
  if (input.state === "not_configured") {
    return "missing";
  }

  if (input.state === "driver_missing") {
    return input.configuration;
  }

  return "found";
};
