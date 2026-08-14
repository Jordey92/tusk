import { validateMigrations } from "../../core/validate-migrations.js";
import {
  createResultPayload,
  writeJson,
} from "../../utils/cli-output.js";
import type { ParsedCommandArgs } from "../../utils/cli-parser.js";
import { createDatabaseConnection } from "../database.js";
import { printValidation } from "../print.js";

export const runValidateCommand = async (
  migrationsPath: string,
  parsedArgs: ParsedCommandArgs
): Promise<number> => {
  if (parsedArgs.checkDatabase) {
    const database = await createDatabaseConnection({ migrationsPath });

    try {
      const result = await validateMigrations(migrationsPath, {
        adapter: database.adapter,
        checkDatabase: true,
      });

      if (parsedArgs.json) {
        const { ok, ...validation } = result;
        writeJson(createResultPayload("validate", ok, validation));
      } else {
        printValidation(result);
      }

      return result.ok ? 0 : 1;
    } finally {
      await database.cleanup();
    }
  }

  const result = await validateMigrations(migrationsPath);
  if (parsedArgs.json) {
    const { ok, ...validation } = result;
    writeJson(createResultPayload("validate", ok, validation));
  } else {
    printValidation(result);
  }

  return result.ok ? 0 : 1;
};
