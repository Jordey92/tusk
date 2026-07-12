import { describe, expect, test } from "bun:test";
import type { DoctorReport } from "../types/doctor";
import { collectDoctorNextSteps, formatDoctorReport } from "./doctor-output";

const createReport = (
  checks: DoctorReport["checks"],
  summary: DoctorReport["summary"] = {
    passed: 1,
    warnings: 0,
    errors: 2,
    skipped: 0,
  }
): DoctorReport => ({
  result: summary.errors === 0 ? "pass" : "fail",
  summary,
  environment: {
    tuskVersion: "0.5.0",
    migrationsPath: "./migrations",
    databaseConfiguration: "missing",
  },
  database: {
    state: "not_configured",
  },
  checks,
});

describe("doctor human output", () => {
  test("leads with missing driver when fresh setup is also missing migrations", () => {
    const report = createReport([
      {
        id: "tusk.version",
        status: "pass",
        message: "Tusk version resolved: 0.5.0",
      },
      {
        id: "migrations.path",
        status: "fail",
        message:
          "Migrations path does not exist: ./migrations. Run `tusk init` to create a migrations directory.",
      },
      {
        id: "database.driver",
        status: "fail",
        message: "No supported Postgres client found.\n\nInstall one of:\n\n  bun add pg",
      },
    ]);

    const output = formatDoctorReport(report);
    const firstCheckLine = output
      .split("\n")
      .find((line) => line.startsWith("✗") || line.startsWith("✓"));

    expect(firstCheckLine).toBe("✗ No supported Postgres client found.");
    expect(output).toContain("Install one of:");
    expect(output).toContain("  1. Install a Postgres client, for example: bun add pg");
    expect(output).toContain("  2. Run tusk init to create a migrations directory");
    expect(output).toContain("  3. Run tusk doctor again");
  });

  test("keeps normal check order when only the driver is missing", () => {
    const report = createReport([
      {
        id: "tusk.version",
        status: "pass",
        message: "Tusk version resolved: 0.5.0",
      },
      {
        id: "migrations.path",
        status: "pass",
        message: "Migrations path exists: ./migrations",
      },
      {
        id: "database.driver",
        status: "fail",
        message: "No supported Postgres client found.",
      },
    ], {
      passed: 2,
      warnings: 0,
      errors: 1,
      skipped: 0,
    });

    const output = formatDoctorReport(report);
    const checkLines = output
      .split("\n")
      .filter((line) => line.startsWith("✓") || line.startsWith("✗"));

    expect(checkLines).toEqual([
      "✓ Tusk version resolved: 0.5.0",
      "✓ Migrations path exists: ./migrations",
      "✗ No supported Postgres client found.",
    ]);
  });

  test("suggests creating migration files when the project is initialized but empty", () => {
    const report = createReport([
      {
        id: "migrations.valid",
        status: "warn",
        message: "Migration files are missing",
        context: {
          files: 0,
        },
      },
    ], {
      passed: 0,
      warnings: 1,
      errors: 0,
      skipped: 0,
    });

    expect(collectDoctorNextSteps(report)).toEqual([
      "Add an .up.sql and .down.sql migration pair",
      "Run tusk doctor again",
    ]);
  });

  test("explains how to configure a missing database", () => {
    const report = createReport([
      {
        id: "database.config",
        status: "fail",
        message: "Database configuration was not found",
        context: {
          cause: "Missing required database configuration: DB_NAME, DB_USER, DB_PASSWORD",
        },
      },
    ]);

    const output = formatDoctorReport(report);

    expect(output).toContain(
      "Cause: Missing required database configuration: DB_NAME, DB_USER, DB_PASSWORD"
    );
    expect(output).toContain(
      "1. Set DATABASE_URL, or set DB_NAME, DB_USER, and DB_PASSWORD"
    );
    expect(output).toContain("2. Run tusk doctor again");
  });

  test("shows connection causes and a concrete recovery step", () => {
    const report = createReport([
      {
        id: "database.connection",
        status: "fail",
        message: "Database connection failed",
        context: {
          cause: "connect ECONNREFUSED 127.0.0.1:5432",
        },
      },
    ]);

    const output = formatDoctorReport(report);

    expect(output).toContain("Cause: connect ECONNREFUSED 127.0.0.1:5432");
    expect(output).toContain(
      "Check the database URL, credentials, network access, and server availability"
    );
    expect(output).toContain("Run tusk doctor again");
  });

  test("omits blank causes", () => {
    const report = createReport([
      {
        id: "database.connection",
        status: "fail",
        message: "Database connection failed",
        context: { cause: "   " },
      },
    ]);

    expect(formatDoctorReport(report)).not.toContain("Cause:");
  });

  test("maps invalid migration and database state to focused commands", () => {
    const report = createReport([
      {
        id: "migrations.valid",
        status: "fail",
        message: "Migration validation found 1 error",
      },
      {
        id: "database.migrationTable",
        status: "fail",
        message: "_migrations table has an invalid shape",
      },
      {
        id: "database.drift",
        status: "fail",
        message: "Database validation found 1 error",
      },
      {
        id: "database.advisoryLock",
        status: "warn",
        message: "Advisory migration lock could not be acquired",
      },
    ]);

    expect(collectDoctorNextSteps(report)).toEqual([
      "Run tusk validate and fix every reported migration error",
      "Compare _migrations with docs/metadata-table.md before repairing it",
      "Run tusk validate --db and resolve migration drift",
      "Confirm no other migration runner is active, then retry",
      "Run tusk doctor again",
    ]);
  });

  test("does not infer empty migrations from message text alone", () => {
    const report = createReport([
      {
        id: "migrations.valid",
        status: "warn",
        message:
          "No migration files found yet. Add an .up.sql and .down.sql migration pair before running `tusk up`.",
      },
    ], {
      passed: 0,
      warnings: 1,
      errors: 0,
      skipped: 0,
    });

    expect(collectDoctorNextSteps(report)).toEqual([]);
  });

  test("omits next steps when no actionable setup step is available", () => {
    const report = createReport([
      {
        id: "tusk.version",
        status: "pass",
        message: "Tusk version resolved: 0.5.0",
      },
    ], {
      passed: 1,
      warnings: 0,
      errors: 0,
      skipped: 0,
    });

    expect(formatDoctorReport(report)).not.toContain("Next steps:");
  });

  test("does not add spacer lines after the final multiline check", () => {
    const report = createReport([
      {
        id: "custom.check",
        status: "fail",
        message: "First line\nSecond line",
      },
    ]);

    const output = formatDoctorReport(report);

    expect(output).toContain("Second line\n────────────────");
    expect(output).not.toContain("Second line\n\n────────────────");
  });
});
