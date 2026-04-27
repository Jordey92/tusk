import { describe, expect, test } from "bun:test";
import {
  getCliDownCount,
  parseCommandArgs,
  validateCommand,
} from "./cli-parser";
import { isTuskError } from "./errors";

const parseAndValidate = (command: string, args: string[]) => {
  const parsed = parseCommandArgs(command, args);
  validateCommand(command, parsed);
  return parsed;
};

const expectValidationError = (callback: () => unknown, message: string) => {
  try {
    callback();
    throw new Error("Expected validation error");
  } catch (error) {
    expect(isTuskError(error)).toBe(true);
    expect(error).toHaveProperty("code", "VALIDATION_ERROR");
    expect(error).toHaveProperty("message", expect.stringContaining(message));
  }
};

describe("CLI parser", () => {
  test("defaults down to one rollback when no selector is provided", () => {
    const parsed = parseAndValidate("down", []);

    expect(parsed).toMatchObject({
      json: false,
      dryRun: false,
      downAll: false,
    });
    expect(parsed.downCount).toBeUndefined();
    expect(getCliDownCount(parsed)).toBe(1);
  });

  test("parses counted down rollback with dry-run and JSON flags", () => {
    const parsed = parseAndValidate("down", ["3", "--dry-run", "--json"]);

    expect(parsed).toMatchObject({
      json: true,
      dryRun: true,
      downAll: false,
      downCount: "3",
    });
    expect(getCliDownCount(parsed)).toBe(3);
  });

  test("parses explicit all-history down rollback", () => {
    const parsed = parseAndValidate("down", ["--all", "--dry-run", "--json"]);

    expect(parsed).toMatchObject({
      json: true,
      dryRun: true,
      downAll: true,
    });
    expect(parsed.downCount).toBeUndefined();
    expect(getCliDownCount(parsed)).toBeUndefined();
  });

  test("rejects ambiguous down rollback selectors", () => {
    expectValidationError(
      () => parseCommandArgs("down", ["--all", "1"]),
      "cannot combine --all with a count"
    );
    expectValidationError(
      () => parseCommandArgs("down", ["1", "--all"]),
      "cannot combine --all with a count"
    );
    expectValidationError(
      () => parseCommandArgs("down", ["1", "2"]),
      "accepts at most one optional count"
    );
  });

  test("rejects invalid down counts and options", () => {
    const parsed = parseCommandArgs("down", ["1abc"]);

    expectValidationError(
      () => validateCommand("down", parsed),
      "Count must be a positive integer"
    );
    expectValidationError(
      () => parseCommandArgs("down", ["--everything"]),
      "Unknown down option"
    );
  });

  test("parses create, validate, and status command flags", () => {
    expect(parseAndValidate("create", ["widgets", "--json"])).toMatchObject({
      json: true,
      createName: "widgets",
    });
    expect(parseAndValidate("validate", ["--db", "--json"])).toMatchObject({
      json: true,
      checkDatabase: true,
    });
    expect(parseAndValidate("status", ["--exit-code", "--json"])).toMatchObject({
      json: true,
      status: {
        exitCode: true,
        json: true,
        quiet: false,
      },
    });
  });

  test("parses doctor JSON output", () => {
    expect(parseAndValidate("doctor", ["--json"])).toMatchObject({
      json: true,
    });
  });

  test("rejects invalid command combinations", () => {
    expectValidationError(
      () => validateCommand("create", parseCommandArgs("create", [])),
      "Migration name required"
    );
    expectValidationError(
      () => parseCommandArgs("create", ["one", "two"]),
      "Create command accepts exactly one migration name argument"
    );
    expectValidationError(
      () => validateCommand("status", parseCommandArgs("status", ["--json", "--quiet"])),
      "cannot be combined"
    );
    expectValidationError(
      () => validateCommand("unknown", parseCommandArgs("unknown", ["--flag"])),
      "Unknown command"
    );
    expectValidationError(
      () => parseCommandArgs("doctor", ["--verbose"]),
      "Unknown doctor option"
    );
  });
});
