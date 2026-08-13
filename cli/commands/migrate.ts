import { getMigrationStatus } from "../../core/migration-status.js";
import {
  createDownPlan,
  createUpPlan,
} from "../../core/plan-migrations.js";
import { runDown, runUp } from "../../core/run-migrations.js";
import {
  createSuccessPayload,
  writeJson,
} from "../../utils/cli-output.js";
import type { ParsedCommandArgs } from "../../utils/cli-parser.js";
import { logger } from "../../utils/logger.js";
import { createDatabaseConnection } from "../database.js";
import {
  printDownResult,
  printPlan,
  printStatus,
} from "../print.js";
import { getCliRollbackTarget } from "../rollback-target.js";

type DatabaseCommand = "up" | "down" | "status";

export const runDatabaseCommand = async (
  command: DatabaseCommand,
  migrationsPath: string,
  parsedArgs: ParsedCommandArgs
): Promise<number> => {
  const database = await createDatabaseConnection();
  const adapter = database.adapter;

  try {
    if (command === "up") {
      if (parsedArgs.dryRun) {
        logger.info("Planning up migrations");
        const plan = await createUpPlan(adapter, migrationsPath);

        if (parsedArgs.json) {
          writeJson(
            createSuccessPayload("up", {
              dryRun: true,
              direction: plan.direction,
              migrations: plan.migrations,
              summary: plan.summary,
            })
          );
        } else {
          printPlan(plan);
        }

        return 0;
      }

      logger.info("Running up migrations");
      const upResult = await runUp(adapter, migrationsPath);
      if (parsedArgs.json) {
        writeJson(createSuccessPayload("up", upResult));
      } else {
        console.log(`✓ Executed ${upResult.executed} migration(s)`);
      }
      return 0;
    }

    if (command === "down") {
      const target = getCliRollbackTarget(parsedArgs);
      if (parsedArgs.dryRun) {
        logger.info("Planning down migrations", { target });
        const plan = await createDownPlan(adapter, migrationsPath, target);

        if (parsedArgs.json) {
          writeJson(
            createSuccessPayload("down", {
              dryRun: true,
              direction: plan.direction,
              migrations: plan.migrations,
              summary: plan.summary,
            })
          );
        } else {
          printPlan(plan);
        }

        return 0;
      }

      logger.info("Running down migrations", { target });
      const downResult = await runDown(adapter, migrationsPath, target);
      if (parsedArgs.json) {
        writeJson(createSuccessPayload("down", downResult));
      } else {
        printDownResult(downResult);
      }
      return 0;
    }

    logger.info("Checking migration status");
    const status = await getMigrationStatus(adapter, migrationsPath);

    if (parsedArgs.status.json) {
      writeJson(createSuccessPayload("status", status));

      if (parsedArgs.status.exitCode && status.summary.pending > 0) {
        return 1;
      }

      return 0;
    }

    printStatus(status, parsedArgs.status.quiet);

    if (parsedArgs.status.exitCode && status.summary.pending > 0) {
      return 1;
    }

    return 0;
  } finally {
    await database.cleanup();
  }
};
