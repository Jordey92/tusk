import { describe, expect, test } from "bun:test";
import { createValidationError, createMigrationFileError } from "./errors";
import {
  createErrorPayload,
  createResultPayload,
  createSuccessPayload,
} from "./cli-output";

describe("CLI output helpers", () => {
  test("creates success payloads with a stable envelope", () => {
    const payload = createSuccessPayload("create", {
      upFile: "1_test.up.sql",
      downFile: "1_test.down.sql",
    });

    expect(payload).toEqual({
      ok: true,
      command: "create",
      upFile: "1_test.up.sql",
      downFile: "1_test.down.sql",
    });
  });

  test("success payload data cannot override the envelope at runtime", () => {
    const data: { upFile: string } = {
      upFile: "1_test.up.sql",
    };
    Object.assign(data, {
      ok: false,
      command: "down",
    });

    const payload = createSuccessPayload(
      "create",
      data
    );

    expect(payload).toEqual({
      ok: true,
      command: "create",
      upFile: "1_test.up.sql",
    });
  });

  test("creates result payloads for commands that can complete with findings", () => {
    const payload = createResultPayload("doctor", false, {
      result: "fail",
      summary: {
        passed: 1,
        warnings: 0,
        errors: 1,
        skipped: 0,
      },
    });

    expect(payload).toEqual({
      ok: false,
      command: "doctor",
      result: "fail",
      summary: {
        passed: 1,
        warnings: 0,
        errors: 1,
        skipped: 0,
      },
    });
  });

  test("creates structured Tusk error payloads", () => {
    const cause = new Error("permission denied");
    const payload = createErrorPayload(
      createMigrationFileError("1_test.up.sql", "bad SQL", cause),
      "validate"
    );

    expect(payload).toEqual({
      ok: false,
      command: "validate",
      error: {
        code: "MIGRATION_FILE_INVALID",
        message: "Invalid migration file: 1_test.up.sql. bad SQL",
        cause: "permission denied",
        context: {
          filename: "1_test.up.sql",
          reason: "bad SQL",
        },
      },
    });
  });

  test("omits empty optional error fields", () => {
    const payload = createErrorPayload(
      createValidationError("bad input", {}),
      "status"
    );

    expect(payload).toEqual({
      ok: false,
      command: "status",
      error: {
        code: "VALIDATION_ERROR",
        message: "bad input",
      },
    });
  });

  test("creates unexpected error payloads for unknown errors", () => {
    const errorPayload = createErrorPayload(new Error("boom"), "up");
    const primitivePayload = createErrorPayload("boom", "up");

    expect(errorPayload).toEqual({
      ok: false,
      command: "up",
      error: {
        code: "UNEXPECTED_ERROR",
        message: "boom",
      },
    });
    expect(primitivePayload.error.message).toBe("boom");
  });
});
