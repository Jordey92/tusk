import { runDoctor } from "../../core/doctor.js";
import {
  createResultPayload,
  writeJson,
} from "../../utils/cli-output.js";
import type { ParsedCommandArgs } from "../../utils/cli-parser.js";
import { createDoctorDatabaseInput } from "../database.js";
import { printDoctor } from "../print.js";

export const runDoctorCommand = async (
  migrationsPath: string,
  parsedArgs: ParsedCommandArgs,
  tuskVersion: string
): Promise<number> => {
  const doctorDatabase = await createDoctorDatabaseInput();

  try {
    const report = await runDoctor({
      migrationsPath,
      tuskVersion,
      database: doctorDatabase.database,
    });

    if (parsedArgs.json) {
      writeJson(
        createResultPayload("doctor", report.result === "pass", report)
      );
    } else {
      printDoctor(report);
    }

    return report.result === "pass" ? 0 : 1;
  } finally {
    await doctorDatabase.cleanup();
  }
};
