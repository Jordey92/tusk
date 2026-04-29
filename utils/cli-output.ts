import type {
  CliCommand,
  CliErrorPayload,
  CliResultPayload,
  CliSuccessPayload,
} from "../types/cli.js";
import type { StructuredContext } from "../types/structured.js";
import { isTuskError } from "./errors.js";

export const createSuccessPayload = <TCommand extends CliCommand, T extends object>(
  command: TCommand,
  data: T & { ok?: never; command?: never }
): CliSuccessPayload<TCommand> & T => ({
  ...data,
  ok: true,
  command,
});

export const createResultPayload = <TCommand extends CliCommand, T extends object>(
  command: TCommand,
  ok: boolean,
  data: T & { ok?: never; command?: never }
): CliResultPayload<TCommand, T> => ({
  ...data,
  ok,
  command,
});

export const createErrorPayload = <TCommand extends string>(
  error: unknown,
  command: TCommand
): CliErrorPayload<TCommand> => {
  if (isTuskError(error)) {
    const payload: CliErrorPayload<TCommand> = {
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
