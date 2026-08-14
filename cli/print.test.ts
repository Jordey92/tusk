import { afterEach, describe, expect, test } from "bun:test";
import type { MigrationPlan } from "../core/plan-migrations";
import type { ValidationResult } from "../core/validate-migrations";
import type { MigrationStatusPayload } from "../types/cli";
import {
  printDownResult,
  printInitNextSteps,
  printPlan,
  printStatus,
  printValidation,
} from "./print";

const logs: string[] = [];
const originalLog = console.log;

afterEach(() => {
  logs.length = 0;
  console.log = originalLog;
});

const captureLogs = () => {
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
};

describe("printStatus", () => {
  const status: MigrationStatusPayload = {
    executed: [
      {
        filename: "1_create.up.sql",
        executedAt: "2024-01-15T12:00:00.000Z",
      },
    ],
    pending: [{ filename: "2_add.up.sql" }],
    summary: { executed: 1, pending: 1 },
  };

  test("prints detailed status by default", () => {
    captureLogs();
    printStatus(status, false);

    const output = logs.join("\n");
    expect(output).toContain("Migration Status:");
    expect(output).toContain("1_create.up.sql");
    expect(output).toContain("2_add.up.sql");
    expect(output).toContain("Total: 1 executed, 1 pending");
  });

  test("prints only the summary when quiet", () => {
    captureLogs();
    printStatus(status, true);
    expect(logs).toEqual(["1 executed, 1 pending"]);
  });

  test("omits empty executed and pending sections", () => {
    captureLogs();
    printStatus(
      {
        executed: [],
        pending: [],
        summary: { executed: 0, pending: 0 },
      },
      false
    );

    const output = logs.join("\n");
    expect(output).toContain("Migration Status:");
    expect(output).not.toContain("\nExecuted:");
    expect(output).not.toContain("\nPending:");
    expect(output).toContain("Total: 0 executed, 0 pending");
  });
});

describe("printPlan", () => {
  test("prints up dry-run details with checksums", () => {
    captureLogs();
    const plan: MigrationPlan = {
      direction: "up",
      migrations: [
        {
          direction: "up",
          filename: "1_create.up.sql",
          timestamp: "1",
          checksum: "abc123",
          sql: "CREATE TABLE widgets (id INT);",
        },
      ],
      summary: { planned: 1, total: 1, alreadyExecuted: 0 },
    };

    printPlan(plan);
    const output = logs.join("\n");
    expect(output).toContain("Dry run: 1 migration(s) would execute");
    expect(output).toContain("Checksum: abc123");
    expect(output).toContain("CREATE TABLE widgets (id INT);");
  });

  test("prints down dry-run details and partial request note", () => {
    captureLogs();
    const plan: MigrationPlan = {
      direction: "down",
      migrations: [
        {
          direction: "down",
          filename: "1_create.down.sql",
          timestamp: "1",
          rollbackOf: "1_create.up.sql",
          sql: "DROP TABLE widgets;",
        },
      ],
      summary: {
        planned: 1,
        total: 1,
        rollbackTarget: {
          mode: "count",
          requestedCount: 5,
          availableRollbackCount: 1,
        },
      },
    };

    printPlan(plan);
    const output = logs.join("\n");
    expect(output).toContain("would roll back");
    expect(output).toContain("Requested 5 rollback(s), but only 1");
    expect(output).toContain("Rollback of: 1_create.up.sql");
  });

  test("does not claim a partial rollback when counts match", () => {
    captureLogs();
    const plan: MigrationPlan = {
      direction: "down",
      migrations: [
        {
          direction: "down",
          filename: "1_create.down.sql",
          timestamp: "1",
          rollbackOf: "1_create.up.sql",
          sql: "DROP TABLE widgets;",
        },
      ],
      summary: {
        planned: 1,
        total: 1,
        rollbackTarget: {
          mode: "count",
          requestedCount: 1,
          availableRollbackCount: 1,
        },
      },
    };

    printPlan(plan);
    expect(logs.join("\n")).not.toContain("Requested 1 rollback(s), but only");
  });

  test("omits the trailing separator when the plan is empty", () => {
    captureLogs();
    printPlan({
      direction: "up",
      migrations: [],
      summary: { planned: 0, total: 0, alreadyExecuted: 0 },
    });

    expect(logs.join("\n")).toBe("Dry run: 0 migration(s) would execute");
  });
});

describe("printDownResult", () => {
  test("reports when nothing rolled back", () => {
    captureLogs();
    printDownResult({
      executed: 0,
      pending: 0,
      rollbackTarget: { mode: "count", requestedCount: 1, availableRollbackCount: 0 },
    });
    expect(logs[0]).toContain("No applied migrations to roll back");
  });

  test("reports a partial count rollback", () => {
    captureLogs();
    printDownResult({
      executed: 1,
      pending: 0,
      rollbackTarget: {
        mode: "count",
        requestedCount: 3,
        availableRollbackCount: 1,
      },
    });
    expect(logs[0]).toContain("Requested 3 rollback(s)");
    expect(logs[0]).toContain("Rolled back 1 migration(s)");
  });

  test("uses the exact rollback count message when request matches availability", () => {
    captureLogs();
    printDownResult({
      executed: 2,
      pending: 0,
      rollbackTarget: {
        mode: "count",
        requestedCount: 2,
        availableRollbackCount: 2,
      },
    });
    expect(logs).toEqual(["✓ Rolled back 2 migration(s)"]);
  });

  test("reports a full rollback count", () => {
    captureLogs();
    printDownResult({
      executed: 2,
      pending: 0,
      rollbackTarget: { mode: "all", availableRollbackCount: 2 },
    });
    expect(logs).toEqual(["✓ Rolled back 2 migration(s)"]);
  });
});

describe("printValidation", () => {
  test("prints success when there are no issues", () => {
    captureLogs();
    const result: ValidationResult = {
      ok: true,
      issues: [],
      summary: { errors: 0, warnings: 0, files: 2, up: 1, down: 1 },
    };
    printValidation(result);
    expect(logs[0]).toContain("Validation passed (2 migration file(s))");
  });

  test("prints errors and warnings with a summary", () => {
    captureLogs();
    const result: ValidationResult = {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "UNPAIRED_FILE",
          message: "missing down",
          filename: "1.up.sql",
        },
        {
          severity: "warning",
          code: "EMPTY_FILE",
          message: "empty",
        },
      ],
      summary: { errors: 1, warnings: 1, files: 1, up: 1, down: 0 },
    };
    printValidation(result);
    const output = logs.join("\n");
    expect(output).toContain("[ERROR] UNPAIRED_FILE 1.up.sql: missing down");
    expect(output).toContain("[WARN] EMPTY_FILE: empty");
    expect(output).toContain("Validation failed: 1 error(s), 1 warning(s)");
  });
});

describe("printInitNextSteps", () => {
  test("prints the post-init guidance", () => {
    captureLogs();
    printInitNextSteps();
    expect(logs.join("\n")).toContain("Run tusk doctor");
  });
});