import { afterEach, describe, expect, test } from "bun:test";
import { getCommandHelp, renderHelp, renderVersion } from "./help";

const logs: string[] = [];
const originalLog = console.log;

afterEach(() => {
  logs.length = 0;
  console.log = originalLog;
});

const captureLogs = () => {
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
};

describe("renderHelp", () => {
  test("prints the global usage overview", () => {
    captureLogs();
    renderHelp();

    const output = logs.join("\n");
    expect(output).toContain("Usage: tusk <command> [options]");
    expect(output).toContain("tusk create add_user_table");
    expect(output).toContain("tusk doctor --json");
    expect(output).toContain("TUSK_MIGRATION_LOCK_ID");
    expect(output).toContain("tusk.config.json");
    expect(output).toContain("TypeScript tusk.config.ts loads under Bun");
    expect(output).toContain("on Node use JSON");
  });
});

describe("getCommandHelp", () => {
  test("returns usage for known commands", () => {
    expect(getCommandHelp("create")).toContain("tusk create <name>");
    expect(getCommandHelp("down")).toContain("--allow-baseline-rollback");
    expect(getCommandHelp("unknown")).toBeUndefined();
  });
});

describe("renderVersion", () => {
  test("prints the package version line", async () => {
    captureLogs();
    await renderVersion("1.2.3");
    expect(logs).toEqual(["tusk v1.2.3"]);
  });
});
