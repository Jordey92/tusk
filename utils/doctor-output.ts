import type { DoctorReport } from "../types/doctor.js";

type DoctorCheck = DoctorReport["checks"][number];

const DRIVER_CHECK_ID = "database.driver";
const MIGRATIONS_PATH_CHECK_ID = "migrations.path";
const MIGRATIONS_VALID_CHECK_ID = "migrations.valid";

const doctorStatusSymbol = (status: DoctorCheck["status"]) => {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  if (status === "fail") return "✗";
  return "-";
};

const getDoctorCheck = (report: DoctorReport, id: string) =>
  report.checks.find((check) => check.id === id);

const hasNoMigrationFiles = (check: DoctorCheck | undefined) =>
  check?.status === "warn" &&
  typeof check.context?.files === "number" &&
  check.context.files === 0;

const orderDoctorChecksForHuman = (report: DoctorReport): DoctorCheck[] => {
  const driverCheck = getDoctorCheck(report, DRIVER_CHECK_ID);
  const migrationsPathCheck = getDoctorCheck(report, MIGRATIONS_PATH_CHECK_ID);

  if (driverCheck?.status !== "fail" || migrationsPathCheck?.status !== "fail") {
    return report.checks;
  }

  const prioritizedIds = new Set([DRIVER_CHECK_ID, MIGRATIONS_PATH_CHECK_ID]);
  return [
    driverCheck,
    migrationsPathCheck,
    ...report.checks.filter((check) => !prioritizedIds.has(check.id)),
  ];
};

export const collectDoctorNextSteps = (report: DoctorReport): string[] => {
  const steps: string[] = [];
  const driverMissing = getDoctorCheck(report, DRIVER_CHECK_ID)?.status === "fail";
  const migrationsPathMissing =
    getDoctorCheck(report, MIGRATIONS_PATH_CHECK_ID)?.status === "fail";
  const migrationsEmpty = hasNoMigrationFiles(
    getDoctorCheck(report, MIGRATIONS_VALID_CHECK_ID)
  );

  if (driverMissing) {
    steps.push("Install a Postgres client, for example: bun add pg");
  }

  if (migrationsPathMissing) {
    steps.push("Run tusk init to create a migrations directory");
  } else if (!driverMissing && migrationsEmpty) {
    steps.push("Add an .up.sql and .down.sql migration pair");
  }

  if (driverMissing || migrationsPathMissing) {
    steps.push("Run tusk doctor");
  } else if (migrationsEmpty) {
    steps.push("Run tusk doctor");
    steps.push("Run tusk up");
  }

  return steps;
};

export const formatDoctorReport = (report: DoctorReport) => {
  const lines = ["", "Tusk Doctor", "─".repeat(60)];

  const orderedChecks = orderDoctorChecksForHuman(report);
  orderedChecks.forEach((check, index) => {
    lines.push(`${doctorStatusSymbol(check.status)} ${check.message}`);
    if (check.message.includes("\n") && index < orderedChecks.length - 1) {
      lines.push("");
    }
  });

  const nextSteps = collectDoctorNextSteps(report);
  if (nextSteps.length > 0) {
    lines.push("", "Next steps:");
    nextSteps.forEach((step, index) => {
      lines.push(`  ${index + 1}. ${step}`);
    });
  }

  lines.push("─".repeat(60));
  lines.push(
    `Summary: ${report.summary.passed} passed, ` +
      `${report.summary.warnings} warning(s), ` +
      `${report.summary.errors} error(s), ` +
      `${report.summary.skipped} skipped`
  );

  return lines.join("\n");
};
