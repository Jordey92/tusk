import {
  createErrorPayload,
  writeJson,
} from "../utils/cli-output.js";
import {
  parseCommandArgs,
  validateCommand,
} from "../utils/cli-parser.js";
import {
  createConfigurationError,
  formatTuskError,
  isDriverNotFoundError,
  isTuskError,
} from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { getCurrentDir } from "../utils/runtime.js";
import { getPackageVersion } from "../utils/version.js";
import { runCreateCommand } from "./commands/create.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runInitCommand } from "./commands/init.js";
import { runDatabaseCommand } from "./commands/migrate.js";
import { runValidateCommand } from "./commands/validate.js";
import { renderHelp, renderVersion, showCommandHelp } from "./help.js";
import {
  loadProjectFileConfig,
  resolveProjectSettings,
} from "./project-config.js";

const getVersion = async () => getPackageVersion(getCurrentDir());

export const runCli = async (
  argv: string[] = process.argv,
  migrationsPathOverride?: string
): Promise<number> => {
  const command = argv[2];
  const rawArgs = argv.slice(3);
  const rawJsonRequested = rawArgs.includes("--json");

  if (rawJsonRequested) {
    process.env.LOG_LEVEL = "error";
  }

  try {
    if (!command || command === "--help" || command === "-h") {
      renderHelp();
      return 0;
    }

    if (command === "help") {
      if (rawArgs.length > 1 || !showCommandHelp(rawArgs[0])) {
        throw createConfigurationError(
          `Unknown help topic: ${rawArgs[0] ?? ""}`,
          { topic: rawArgs[0] }
        );
      }
      return 0;
    }

    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      if (!showCommandHelp(command)) {
        throw createConfigurationError(`Unknown command: ${command}`, {
          command,
        });
      }
      return 0;
    }

    if (command === "version" || command === "--version" || command === "-v") {
      if (rawArgs.length > 0) {
        throw createConfigurationError(
          "version does not accept additional arguments",
          {
            args: rawArgs,
          }
        );
      }
      await renderVersion(await getVersion());
      return 0;
    }

    const loadedProjectConfig = await loadProjectFileConfig();
    const projectSettings = resolveProjectSettings(loadedProjectConfig, {
      migrationsPathOverride,
    });
    const migrationsPath = projectSettings.migrationsPath;
    const projectConfig = loadedProjectConfig.config;

    const parsedArgs = parseCommandArgs(command, rawArgs);

    validateCommand(command, parsedArgs);
    logger.info("Starting tusk migration tool", {
      command,
      arg: parsedArgs.createName ?? parsedArgs.downCount,
      rawArgs,
      migrationsPath,
      configPath: projectSettings.configPath,
      schema: projectSettings.schema,
    });

    if (command === "create") {
      return await runCreateCommand(migrationsPath, parsedArgs);
    }

    if (command === "validate") {
      return await runValidateCommand(migrationsPath, parsedArgs, {
        projectConfig,
      });
    }

    if (command === "doctor") {
      return await runDoctorCommand(
        migrationsPath,
        parsedArgs,
        await getVersion(),
        { projectConfig }
      );
    }

    if (command === "init") {
      const exitCode = await runInitCommand(migrationsPath, parsedArgs, {
        projectConfig,
        schema: projectSettings.schema,
      });
      logger.info("Migration tool completed successfully");
      return exitCode;
    }

    if (command === "up" || command === "down" || command === "status") {
      const exitCode = await runDatabaseCommand(
        command,
        migrationsPath,
        parsedArgs,
        { projectConfig }
      );
      logger.info("Migration tool completed successfully");
      return exitCode;
    }

    renderHelp();
    logger.info("Migration tool completed successfully");
    return 0;
  } catch (error) {
    if (rawJsonRequested) {
      writeJson(createErrorPayload(error, command ?? "unknown"));
      return 1;
    }

    if (isTuskError(error)) {
      console.error(
        isDriverNotFoundError(error) ? error.message : formatTuskError(error)
      );
    } else {
      console.error(
        "Unexpected error:",
        error instanceof Error ? error.message : String(error)
      );
    }

    return 1;
  }
};
