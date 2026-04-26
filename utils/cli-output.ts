import type { CliCommand, CliErrorPayload, CliSuccessPayload } from "../types/cli.js";
import type { StructuredContext } from "../types/structured.js";
import { isTuskError } from "./errors.js";

export const createSuccessPayload = <T extends object>(
  command: CliCommand,
  data: T & { ok?: never; command?: never }
): CliSuccessPayload & T => ({
  ...data,
  ok: true,
  command,
});

export const createErrorPayload = (
  error: unknown,
  command?: string
): CliErrorPayload => {
  if (isTuskError(error)) {
    const payload: CliErrorPayload = {
      ok: false,
      command,
      error: {
        code: error.code,
        message: error.message,
      },
    };

    if (error.cause) {
      payload.error.cause = error.cause.message;
    }

    if (error.context && Object.keys(error.context).length > 0) {
      payload.error.context = error.context as StructuredContext;
    }

    return payload;
  }

  return {
    ok: false,
    command,
    error: {
      code: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  };
};

export const writeJson = (payload: unknown) => {
  console.log(JSON.stringify(payload));
};
