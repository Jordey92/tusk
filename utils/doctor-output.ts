import type { DoctorReport } from "../types/doctor.js";

type DoctorCheck = DoctorReport["checks"][number];

const DRIVER_CHECK_ID = "database.driver";
const MIGRATIONS_PATH_CHECK_ID = "migrations.path";
const MIGRATIONS_VALID_CHECK_ID = "migrations.valid";
const DATABASE_CONFIG_CHECK_ID = "database.config";
const DATABASE_CONNECTION_CHECK_ID = "database.connection";
const DATABASE_MIGRATION_TABLE_CHECK_ID = "database.migrationTable";
const DATABASE_DRIFT_CHECK_ID = "database.drift";
const DATABASE_ADVISORY_LOCK_CHECK_ID = "database.advisoryLock";

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

const needsAttention = (check: DoctorCheck | undefined) =>
  check?.status === "fail" || check?.status === "warn";

const addStep = (steps: string[], step: string) => {
  if (!steps.includes(step)) {
    steps.push(step);
  }
};

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
  const migrationsInvalid =
    getDoctorCheck(report, MIGRATIONS_VALID_CHECK_ID)?.status === "fail";
  const databaseConfigMissing =
    getDoctorCheck(report, DATABASE_CONFIG_CHECK_ID)?.status === "fail";
  const databaseConnectionFailed =
    getDoctorCheck(report, DATABASE_CONNECTION_CHECK_ID)?.status === "fail";
  const migrationTableInvalid =
    getDoctorCheck(report, DATABASE_MIGRATION_TABLE_CHECK_ID)?.status === "fail";
  const databaseDrift = needsAttention(
    getDoctorCheck(report, DATABASE_DRIFT_CHECK_ID)
  );
  const advisoryLockUnavailable = needsAttention(
    getDoctorCheck(report, DATABASE_ADVISORY_LOCK_CHECK_ID)
  );

  if (driverMissing) {
    addStep(steps, "Install a Postgres client, for example: bun add pg");
  }

  if (migrationsPathMissing) {
    addStep(steps, "Run tusk init to create a migrations directory");
  } else if (!driverMissing && migrationsEmpty) {
    addStep(steps, "Add an .up.sql and .down.sql migration pair");
  }

  if (migrationsInvalid) {
    addStep(steps, "Run tusk validate and fix every reported migration error");
  }

  if (databaseConfigMissing) {
    addStep(
      steps,
      "Set DATABASE_URL, or set DB_NAME, DB_USER, and DB_PASSWORD"
    );
  }

  if (databaseConnectionFailed) {
    addStep(
      steps,
      "Check the database URL, credentials, network access, and server availability"
    );
  }

  if (migrationTableInvalid) {
    addStep(
      steps,
      "Compare _migrations with docs/metadata-table.md before repairing it"
    );
  }

  if (databaseDrift) {
    addStep(steps, "Run tusk validate --db and resolve migration drift");
  }

  if (advisoryLockUnavailable) {
    addStep(
      steps,
      "Confirm no other migration runner is active, then retry"
    );
  }

  const hasRemediation = steps.length > 0;
  if (hasRemediation) {
    addStep(steps, "Run tusk doctor again");
  }

  return steps;
};

export const formatDoctorReport = (report: DoctorReport) => {
  const lines = ["", "Tusk Doctor", "─".repeat(60)];

  const orderedChecks = orderDoctorChecksForHuman(report);
  orderedChecks.forEach((check, index) => {
    lines.push(`${doctorStatusSymbol(check.status)} ${check.message}`);
    const cause = check.context?.cause;
    if (typeof cause === "string" && cause.trim().length > 0) {
      lines.push(`  Cause: ${cause}`);
    }
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
