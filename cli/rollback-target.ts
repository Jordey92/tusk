import {
  getCliDownCount,
  type ParsedCommandArgs,
} from "../utils/cli-parser.js";
import type { RollbackTarget } from "../core/rollback-target.js";

export const getCliRollbackTarget = (
  parsedArgs: ParsedCommandArgs
): RollbackTarget | undefined =>
  parsedArgs.downAll || parsedArgs.allowBaselineRollback
    ? {
        ...(parsedArgs.downAll
          ? { all: true }
          : { count: getCliDownCount(parsedArgs) }),
        allowBaselineRollback: parsedArgs.allowBaselineRollback,
      }
    : getCliDownCount(parsedArgs);
