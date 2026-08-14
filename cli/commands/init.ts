import { createInitialMigration } from "../../core/init-migration.js";
import { initializeProject } from "../../core/init-project.js";
import {
  createSuccessPayload,
  writeJson,
} from "../../utils/cli-output.js";
import type { ParsedCommandArgs } from "../../utils/cli-parser.js";
import { logger } from "../../utils/logger.js";
import { createDatabaseConnection } from "../database.js";
import { printInitNextSteps } from "../print.js";

export const runInitCommand = async (
  migrationsPath: string,
  parsedArgs: ParsedCommandArgs
): Promise<number> => {
  if (!parsedArgs.initFromDb) {
    logger.info("Initialising Tusk project", { migrationsPath });
    const result = await initializeProject(migrationsPath);

    if (parsedArgs.json) {
      writeJson(createSuccessPayload("init", result));
    } else {
      const message = result.created
        ? `Created migrations directory: ${migrationsPath}`
        : `Migrations directory already exists: ${migrationsPath}`;
      console.log(`✓ ${message}`);
      printInitNextSteps();
    }

    return 0;
  }

  logger.info("Generating initial migration from database");
  const database = await createDatabaseConnection({ migrationsPath });
  const adapter = database.adapter;

  try {
    const initResult = await createInitialMigration(adapter, migrationsPath);
    if (parsedArgs.json) {
      writeJson(
        createSuccessPayload("init", {
          upFile: initResult.upFile,
          downFile: initResult.downFile,
          tableCount: initResult.tableCount,
          checksum: initResult.checksum,
          markedAsExecuted: initResult.markedAsExecuted,
          migrationsPath,
          fromDb: true,
        })
      );
    } else {
      console.log(`✓ Created ${initResult.upFile}`);
      console.log(`✓ Created ${initResult.downFile}`);
      console.log(`✓ Introspected ${initResult.tableCount} table(s)`);
      console.log(`✓ Marked ${initResult.upFile} as applied`);
    }
    logger.info("Initial migration created successfully", {
      upFile: initResult.upFile,
      downFile: initResult.downFile,
      tableCount: initResult.tableCount,
      checksum: initResult.checksum,
      markedAsExecuted: initResult.markedAsExecuted,
    });
    return 0;
  } finally {
    await database.cleanup();
  }
};
