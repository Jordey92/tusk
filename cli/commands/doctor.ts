import { runDoctor } from "../../core/doctor.js";
import {
  createResultPayload,
  writeJson,
} from "../../utils/cli-output.js";
import type { ParsedCommandArgs } from "../../utils/cli-parser.js";
import {
  createDoctorDatabaseInput,
} from "../database.js";
import type { TuskProjectFileConfig } from "../project-config.js";
import { printDoctor } from "../print.js";

type DoctorCommandOptions = {
  projectConfig?: TuskProjectFileConfig;
};

export const runDoctorCommand = async (
  migrationsPath: string,
  parsedArgs: ParsedCommandArgs,
  tuskVersion: string,
  options: DoctorCommandOptions = {}
): Promise<number> => {
  const doctorDatabase = await createDoctorDatabaseInput(options);

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
