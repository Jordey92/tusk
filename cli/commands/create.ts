import { createMigrationFile } from "../../core/create-migration.js";
import {
  createSuccessPayload,
  writeJson,
} from "../../utils/cli-output.js";
import type { ParsedCommandArgs } from "../../utils/cli-parser.js";
import { logger } from "../../utils/logger.js";

export const runCreateCommand = async (
  migrationsPath: string,
  parsedArgs: ParsedCommandArgs
): Promise<number> => {
  logger.info("Creating migration", { name: parsedArgs.createName });
  const files = await createMigrationFile(
    migrationsPath,
    parsedArgs.createName!
  );
  if (parsedArgs.json) {
    writeJson(
      createSuccessPayload("create", {
        ...files,
        migrationsPath,
      })
    );
  } else {
    console.log(`✓ Created ${files.upFile}`);
    console.log(`✓ Created ${files.downFile}`);
  }
  logger.info("Migration files created successfully", files);
  return 0;
};
