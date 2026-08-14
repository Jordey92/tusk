import { spawnSync } from "node:child_process";
import { unitTestArgs } from "./unit-test-plan.ts";

const result = spawnSync(process.execPath, unitTestArgs(process.argv.slice(2)), {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
