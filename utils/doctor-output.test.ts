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
  ok: summary.errors === 0,
  summary,
  environment: {
    tuskVersion: "0.5.0",
    migrationsPath: "./migrations",
    databaseConfigured: false,
  },
  database: {
    configured: false,
    connected: false,
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
    expect(output).toContain("  3. Run tusk doctor");
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
        message:
          "No migration files found yet. Add an .up.sql and .down.sql migration pair before running `tusk up`.",
      },
    ], {
      passed: 0,
      warnings: 1,
      errors: 0,
      skipped: 0,
    });

    expect(collectDoctorNextSteps(report)).toEqual([
      "Add an .up.sql and .down.sql migration pair",
      "Run tusk doctor",
      "Run tusk up",
    ]);
  });
});
