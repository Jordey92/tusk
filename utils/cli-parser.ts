import { createValidationError } from "./errors.js";

interface StatusOptions {
  exitCode: boolean;
  json: boolean;
  quiet: boolean;
}

export interface ParsedCommandArgs {
  json: boolean;
  dryRun: boolean;
  checkDatabase: boolean;
  downAll: boolean;
  createName?: string;
  downCount?: string;
  status: StatusOptions;
}

const validCommands = ["create", "init", "up", "down", "status", "validate", "doctor", "version", "help"];

const emptyParsedCommandArgs = (): ParsedCommandArgs => ({
  json: false,
  dryRun: false,
  checkDatabase: false,
  downAll: false,
  status: {
    exitCode: false,
    json: false,
    quiet: false,
  },
});

const parseDownArgs = (rawArgs: string[]): ParsedCommandArgs => {
  const command = "down";
  const parsed = emptyParsedCommandArgs();

  for (const rawArg of rawArgs) {
    if (rawArg === "--json") {
      parsed.json = true;
      continue;
    }

    if (rawArg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (rawArg === "--all") {
      if (parsed.downCount) {
        throw createValidationError(
          "Down command cannot combine --all with a count",
          { command, args: rawArgs }
        );
      }

      parsed.downAll = true;
      continue;
    }

    if (rawArg.startsWith("-")) {
      throw createValidationError(
        `Unknown down option: ${rawArg}. Valid options: --dry-run, --json, --all`,
        { command, arg: rawArg }
      );
    }

    if (parsed.downAll) {
      throw createValidationError(
        "Down command cannot combine --all with a count",
        { command, args: rawArgs }
      );
    }

    if (parsed.downCount) {
      throw createValidationError(
        "Down command accepts at most one optional count argument",
        { command, args: rawArgs }
      );
    }

    parsed.downCount = rawArg;
  }

  return parsed;
};

const parseCreateArgs = (rawArgs: string[]): ParsedCommandArgs => {
  const command = "create";
  const parsed = emptyParsedCommandArgs();
  const positionalArgs = [];

  for (const rawArg of rawArgs) {
    if (rawArg === "--json") {
      parsed.json = true;
      continue;
    }

    positionalArgs.push(rawArg);
  }

  if (positionalArgs.length > 1) {
    throw createValidationError(
      "Create command accepts exactly one migration name argument",
      { command, args: positionalArgs }
    );
  }

  parsed.createName = positionalArgs[0];
  return parsed;
};

const parseUpArgs = (rawArgs: string[]): ParsedCommandArgs => {
  const command = "up";
  const parsed = emptyParsedCommandArgs();

  for (const rawArg of rawArgs) {
    if (rawArg === "--json") {
      parsed.json = true;
      continue;
    }

    if (rawArg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    throw createValidationError(
      `Unknown up option: ${rawArg}. Valid options: --dry-run, --json`,
      { command, arg: rawArg }
    );
  }

  return parsed;
};

const parseInitArgs = (rawArgs: string[]): ParsedCommandArgs => {
  const command = "init";
  const parsed = emptyParsedCommandArgs();

  for (const rawArg of rawArgs) {
    if (rawArg === "--json") {
      parsed.json = true;
      continue;
    }

    throw createValidationError(
      `Unknown init option: ${rawArg}. Valid options: --json`,
      { command, arg: rawArg }
    );
  }

  return parsed;
};

const parseValidateArgs = (rawArgs: string[]): ParsedCommandArgs => {
  const command = "validate";
  const parsed = emptyParsedCommandArgs();

  for (const rawArg of rawArgs) {
    if (rawArg === "--json") {
      parsed.json = true;
      continue;
    }

    if (rawArg === "--db") {
      parsed.checkDatabase = true;
      continue;
    }

    throw createValidationError(
      `Unknown validate option: ${rawArg}. Valid options: --db, --json`,
      { command, arg: rawArg }
    );
  }

  return parsed;
};

const parseStatusArgs = (rawArgs: string[]): ParsedCommandArgs => {
  const command = "status";
  const parsed = emptyParsedCommandArgs();

  for (const rawArg of rawArgs) {
    if (rawArg === "--exit-code") {
      parsed.status.exitCode = true;
      continue;
    }

    if (rawArg === "--quiet") {
      parsed.status.quiet = true;
      continue;
    }

    if (rawArg === "--json") {
      parsed.status.json = true;
      parsed.json = true;
      continue;
    }

    throw createValidationError(
      `Unknown status option: ${rawArg}. Valid options: --exit-code, --quiet, --json`,
      { command, arg: rawArg }
    );
  }

  return parsed;
};

const parseDoctorArgs = (rawArgs: string[]): ParsedCommandArgs => {
  const command = "doctor";
  const parsed = emptyParsedCommandArgs();

  for (const rawArg of rawArgs) {
    if (rawArg === "--json") {
      parsed.json = true;
      continue;
    }

    throw createValidationError(
      `Unknown doctor option: ${rawArg}. Valid options: --json`,
      { command, arg: rawArg }
    );
  }

  return parsed;
};

export const parseCommandArgs = (
  command: string,
  rawArgs: string[]
): ParsedCommandArgs => {
  if (command === "down") return parseDownArgs(rawArgs);
  if (command === "create") return parseCreateArgs(rawArgs);
  if (command === "up") return parseUpArgs(rawArgs);
  if (command === "init") return parseInitArgs(rawArgs);
  if (command === "validate") return parseValidateArgs(rawArgs);
  if (command === "status") return parseStatusArgs(rawArgs);
  if (command === "doctor") return parseDoctorArgs(rawArgs);

  if (validCommands.includes(command) && rawArgs.length > 0) {
    throw createValidationError(
      `${command} does not accept additional arguments`,
      { command, args: rawArgs }
    );
  }

  return emptyParsedCommandArgs();
};

const parsePositiveInteger = (value: string) => {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    return undefined;
  }

  return count;
};

export const getCliDownCount = (parsedArgs: ParsedCommandArgs) => {
  if (parsedArgs.downAll) {
    return undefined;
  }

  if (parsedArgs.downCount) {
    return parsePositiveInteger(parsedArgs.downCount);
  }

  return 1;
};

export const validateCommand = (
  command: string,
  parsedArgs: ParsedCommandArgs
) => {
  if (!validCommands.includes(command)) {
    const tuskError = createValidationError(
      `Unknown command: ${command}. Valid commands: ${validCommands.join(", ")}`,
      { command, validCommands }
    );
    throw tuskError;
  }

  if (command === "create" && !parsedArgs.createName) {
    const tuskError = createValidationError(
      "Migration name required for create command",
      { command }
    );
    throw tuskError;
  }

  if (command === "down" && parsedArgs.downCount) {
    const count = parsePositiveInteger(parsedArgs.downCount);
    if (count === undefined) {
      const tuskError = createValidationError(
        "Count must be a positive integer for down command",
        { command, arg: parsedArgs.downCount }
      );
      throw tuskError;
    }
  }

  if (command === "status" && parsedArgs.status.json && parsedArgs.status.quiet) {
    throw createValidationError(
      "Status options --json and --quiet cannot be combined",
      { command }
    );
  }
};
