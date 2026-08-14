import type { MigrationPlan } from "../core/plan-migrations.js";
import type { DownRunResult } from "../types/migrations.js";
import type { MigrationStatusPayload } from "../types/cli.js";
import type { DoctorReport } from "../types/doctor.js";
import type { ValidationResult } from "../core/validate-migrations.js";
import { formatDoctorReport } from "../utils/doctor-output.js";

export const printStatus = (
  status: MigrationStatusPayload,
  quiet: boolean
) => {
  if (!quiet) {
    console.log("\nMigration Status:");
    console.log("─".repeat(60));
  }

  if (!quiet && status.executed.length > 0) {
    console.log("\nExecuted:");
    status.executed.forEach((migration) => {
      const date = migration.executedAt
        ? new Date(migration.executedAt).toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "unknown";
      console.log(`  ✓ ${migration.filename} (${date})`);
    });
  }

  if (!quiet && status.pending.length > 0) {
    console.log("\nPending:");
    status.pending.forEach((migration) => {
      console.log(`  ⏳ ${migration.filename}`);
    });
  }

  if (!quiet) {
    console.log("\n─".repeat(60));
    console.log(
      `Total: ${status.summary.executed} executed, ${status.summary.pending} pending\n`
    );
  } else {
    console.log(
      `${status.summary.executed} executed, ${status.summary.pending} pending`
    );
  }
};

export const printPlan = (plan: MigrationPlan) => {
  const action = plan.direction === "up" ? "execute" : "roll back";
  console.log(`Dry run: ${plan.summary.planned} migration(s) would ${action}`);
  const rollbackTarget = plan.summary.rollbackTarget;
  if (
    plan.direction === "down" &&
    rollbackTarget?.mode === "count" &&
    rollbackTarget.requestedCount > rollbackTarget.availableRollbackCount
  ) {
    console.log(
      `Requested ${rollbackTarget.requestedCount} rollback(s), but only ` +
        `${rollbackTarget.availableRollbackCount} applied migration(s) are available`
    );
  }

  for (const migration of plan.migrations) {
    console.log("\n" + "─".repeat(60));
    console.log(`${migration.filename}`);
    if (migration.direction === "down") {
      console.log(`Rollback of: ${migration.rollbackOf}`);
    }
    if (migration.direction === "up") {
      console.log(`Checksum: ${migration.checksum}`);
    }
    console.log("\n" + migration.sql.trim());
  }

  if (plan.migrations.length > 0) {
    console.log("\n" + "─".repeat(60));
  }
};

export const printDownResult = (result: DownRunResult) => {
  if (result.executed === 0) {
    console.log("✓ No applied migrations to roll back");
    return;
  }

  if (
    result.rollbackTarget?.mode === "count" &&
    result.rollbackTarget.requestedCount >
      result.rollbackTarget.availableRollbackCount
  ) {
    console.log(
      `✓ Requested ${result.rollbackTarget.requestedCount} rollback(s), but only ` +
        `${result.rollbackTarget.availableRollbackCount} applied migration(s) were available. ` +
        `Rolled back ${result.executed} migration(s)`
    );
    return;
  }

  console.log(`✓ Rolled back ${result.executed} migration(s)`);
};

export const printValidation = (result: ValidationResult) => {
  if (result.issues.length === 0) {
    console.log(
      `✓ Validation passed (${result.summary.files} migration file(s))`
    );
    return;
  }

  for (const issue of result.issues) {
    const prefix = issue.severity === "error" ? "ERROR" : "WARN";
    const file = issue.filename ? ` ${issue.filename}` : "";
    console.log(`[${prefix}] ${issue.code}${file}: ${issue.message}`);
  }

  console.log(
    `Validation ${result.ok ? "passed" : "failed"}: ` +
      `${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`
  );
};

export const printDoctor = (report: DoctorReport) => {
  console.log(formatDoctorReport(report));
};

export const printInitNextSteps = () => {
  console.log("\nNext steps:");
  console.log("  1. Add an .up.sql and .down.sql migration pair");
  console.log("  2. Run tusk doctor");
  console.log("  3. Run tusk up");
};
