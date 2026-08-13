import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "./run";

const logs: string[] = [];
const errors: string[] = [];
const originalLog = console.log;
const originalError = console.error;

afterEach(() => {
  logs.length = 0;
  errors.length = 0;
  console.log = originalLog;
  console.error = originalError;
});

const captureOutput = () => {
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
};

describe("runCli", () => {
  test("prints global help for --help", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("Usage: tusk <command> [options]");
  });

  test("prints command help", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "help", "validate"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("tusk validate [--db] [--json]");
  });

  test("rejects unknown help topics", async () => {
    captureOutput();
    const code = await runCli(["node", "tusk", "help", "nope"]);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Unknown help topic");
  });
});
