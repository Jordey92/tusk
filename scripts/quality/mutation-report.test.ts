import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mergeMutationReports } from "./merge-mutation-reports";
import {
  collectMutants,
  createMutationReport,
  resolveMutationShard,
  selectMutationShard,
  type Mutant,
  type MutantResult,
  type MutationReport,
} from "./mutation-report";

const mutationScript = resolve(
  process.cwd(),
  "scripts/quality/mutation-report.ts",
);

const writeMutationFixtureConfig = async ({
  configPath,
  reportPath,
  targetPath,
  testPath,
  timeoutMs,
}: {
  configPath: string;
  reportPath: string;
  targetPath: string;
  testPath: string;
  timeoutMs: number;
}) => {
  await writeFile(
    configPath,
    JSON.stringify({
      crap: {
        lcovPath: "coverage/lcov.info",
        sourceRoots: [],
        exclude: [],
        threshold: 30,
        reportPath: join(configPath, "..", "crap.json"),
      },
      mutation: {
        minimumScore: 85,
        timeoutMs,
        reportPath,
        targets: [
          {
            file: targetPath,
            testCommand: [process.execPath, testPath],
          },
        ],
      },
    }),
  );
};

const runMutationFixture = async (
  workspace: string,
  configPath: string,
  reportPath: string,
) => {
  const child = Bun.spawn([process.execPath, mutationScript], {
    cwd: workspace,
    env: {
      ...process.env,
      TUSK_QUALITY_CONFIG_PATH: configPath,
      TUSK_MUTATION_REPORT_PATH: reportPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const baseMutants = (total: number): Mutant[] =>
  Array.from({ length: total }, (_, manifestIndex) => ({
    id: `mutant-${manifestIndex}`,
    file: "fixture.ts",
    index: manifestIndex + 1,
    manifestIndex,
    line: manifestIndex + 1,
    description: "fixture mutation",
    start: manifestIndex,
    end: manifestIndex + 1,
    replacement: "false",
  }));

const resultFor = (
  mutant: Mutant,
  status: MutantResult["status"] = "killed",
): MutantResult => ({ ...mutant, status });

const reportsFor = (
  mutants: Mutant[],
  shardTotal: number,
  statuses = new Map<number, MutantResult["status"]>(),
): MutationReport[] =>
  Array.from({ length: shardTotal }, (_, index) => {
    const results = mutants
      .filter((mutant) => mutant.manifestIndex % shardTotal === index)
      .map((mutant) => resultFor(mutant, statuses.get(mutant.manifestIndex)));
    return createMutationReport(results, {
      sourceSha: "fixture-sha",
      configHash: "fixture-config",
      manifestHash: "fixture-manifest",
      manifestTotal: mutants.length,
      shard: { index, total: shardTotal },
      minimumScore: 85,
    });
  });

const mergeExpected = (mutants: Mutant[], shardTotal: number) => ({
  sourceSha: "fixture-sha",
  configHash: "fixture-config",
  manifestHash: "fixture-manifest",
  mutants,
  shardTotal,
  minimumScore: 85,
});

describe("mutation discovery", () => {
  test("mutates runtime expressions without changing TypeScript syntax or types", () => {
    const source = `
      type Enabled = true;
      const values = new Set<string>();
      const predicate = (value: number) => value > 0;
      const enabled = true;
    `;

    const mutants = collectMutants("fixture.ts", source);

    expect(mutants).toHaveLength(2);
    expect(
      mutants.map((mutant) => source.slice(mutant.start, mutant.end)),
    ).toEqual([">", "true"]);
  });
});

describe("mutation sharding", () => {
  test("requires a complete valid shard environment", () => {
    expect(resolveMutationShard({})).toEqual({ index: 0, total: 1 });
    expect(() =>
      resolveMutationShard({ TUSK_MUTATION_SHARD_INDEX: "0" }),
    ).toThrow("must be set together");
    expect(() =>
      resolveMutationShard({
        TUSK_MUTATION_SHARD_INDEX: "4",
        TUSK_MUTATION_SHARD_TOTAL: "4",
      }),
    ).toThrow("must be an integer");
  });

  test("assigns every mutant to exactly one deterministic shard", () => {
    const mutants = baseMutants(67);
    const selected = Array.from({ length: 16 }, (_, index) =>
      selectMutationShard(mutants, { index, total: 16 }),
    ).flat();

    expect(selected).toHaveLength(mutants.length);
    expect(new Set(selected.map((mutant) => mutant.id)).size).toBe(
      mutants.length,
    );
    expect(
      selected.map((mutant) => mutant.manifestIndex).sort((a, b) => a - b),
    ).toEqual(mutants.map((mutant) => mutant.manifestIndex));
  });
});

describe("mutation report aggregation", () => {
  test("merges a complete disjoint shard set at the global threshold", () => {
    const mutants = baseMutants(20);
    const statuses = new Map<number, MutantResult["status"]>([
      [17, "survived"],
      [18, "survived"],
      [19, "survived"],
    ]);

    const report = mergeMutationReports(
      reportsFor(mutants, 4, statuses),
      mergeExpected(mutants, 4),
    );

    expect(report.score).toBe(85);
    expect(report.total).toBe(20);
    expect(report.survived).toBe(3);
  });

  test("rejects missing, duplicate, foreign, incomplete, and sub-threshold reports", () => {
    const mutants = baseMutants(20);
    const reports = reportsFor(mutants, 4);
    expect(() =>
      mergeMutationReports(reports.slice(0, 3), mergeExpected(mutants, 4)),
    ).toThrow("Expected 4");
    expect(() =>
      mergeMutationReports(
        [reports[0], reports[0], reports[2], reports[3]],
        mergeExpected(mutants, 4),
      ),
    ).toThrow("Duplicate mutation shard");

    const foreign = structuredClone(reports);
    foreign[0].results[0].file = "foreign.ts";
    expect(() =>
      mergeMutationReports(foreign, mergeExpected(mutants, 4)),
    ).toThrow("Unexpected mutation result");

    const incomplete = structuredClone(reports);
    incomplete[0].results.pop();
    incomplete[0] = createMutationReport(incomplete[0].results, {
      sourceSha: "fixture-sha",
      configHash: "fixture-config",
      manifestHash: "fixture-manifest",
      manifestTotal: mutants.length,
      shard: { index: 0, total: 4 },
      minimumScore: 85,
    });
    expect(() =>
      mergeMutationReports(incomplete, mergeExpected(mutants, 4)),
    ).toThrow("Expected 20 mutation results");

    const lowScore = new Map<number, MutantResult["status"]>(
      Array.from({ length: 4 }, (_, offset) => [16 + offset, "survived"]),
    );
    expect(() =>
      mergeMutationReports(
        reportsFor(mutants, 4, lowScore),
        mergeExpected(mutants, 4),
      ),
    ).toThrow("below 85%");
  });
});

test("timed-out mutants terminate descendants and restore the source", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "tusk-mutation-timeout-"));
  const targetPath = join(workspace, "target.ts");
  const testPath = join(workspace, "test-runner.ts");
  const markerPath = join(workspace, "orphan-marker");
  const baselineMarkerPath = join(workspace, "baseline-marker");
  const reportPath = join(workspace, "report.json");
  const configPath = join(workspace, "quality.config.json");
  const originalSource = "export const enabled = true;\n";

  try {
    await writeFile(targetPath, originalSource);
    await writeFile(
      testPath,
      `
        import { appendFile, readFile } from "node:fs/promises";
        import { spawn } from "node:child_process";
        const source = await readFile(${JSON.stringify(targetPath)}, "utf8");
        if (source.includes("false")) {
          spawn(process.execPath, ["-e", ${JSON.stringify(
            `process.on("SIGTERM", () => {}); setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "orphan"), 500)`,
          )}], { stdio: "ignore" });
          await new Promise(() => undefined);
        }
        await appendFile(${JSON.stringify(baselineMarkerPath)}, "baseline\\n");
      `,
    );
    await writeFile(
      configPath,
      JSON.stringify({
        crap: {
          lcovPath: "coverage/lcov.info",
          sourceRoots: [],
          exclude: [],
          threshold: 30,
          reportPath: join(workspace, "crap.json"),
        },
        mutation: {
          minimumScore: 85,
          timeoutMs: 100,
          reportPath,
          targets: [
            {
              file: targetPath,
              testCommand: [process.execPath, testPath],
            },
          ],
        },
      }),
    );

    const child = Bun.spawn([process.execPath, mutationScript], {
      cwd: workspace,
      env: {
        ...process.env,
        TUSK_QUALITY_CONFIG_PATH: configPath,
        TUSK_MUTATION_REPORT_PATH: reportPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    expect(await readFile(targetPath, "utf8")).toBe(originalSource);
    const report = JSON.parse(
      await readFile(reportPath, "utf8"),
    ) as MutationReport;
    expect(report.timedOut).toBe(1);
    expect((await readFile(baselineMarkerPath, "utf8")).trim().split("\n"))
      .toHaveLength(3);

    await Bun.sleep(700);
    expect(existsSync(markerPath)).toBe(false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rejects a report when the clean harness becomes unhealthy", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "tusk-mutation-poisoned-"));
  const targetPath = join(workspace, "target.ts");
  const testPath = join(workspace, "test-runner.ts");
  const poisonPath = join(workspace, "poison");
  const reportPath = join(workspace, "report.json");
  const configPath = join(workspace, "quality.config.json");
  const originalSource = "export const enabled = true;\n";

  try {
    await writeFile(targetPath, originalSource);
    await writeFile(
      testPath,
      `
        import { existsSync } from "node:fs";
        import { readFile, writeFile } from "node:fs/promises";
        const source = await readFile(${JSON.stringify(targetPath)}, "utf8");
        if (source.includes("false")) {
          await writeFile(${JSON.stringify(poisonPath)}, "poisoned");
          process.exit(1);
        }
        if (existsSync(${JSON.stringify(poisonPath)})) process.exit(1);
      `,
    );
    await writeMutationFixtureConfig({
      configPath,
      reportPath,
      targetPath,
      testPath,
      timeoutMs: 1_000,
    });

    const result = await runMutationFixture(workspace, configPath, reportPath);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Mutation baseline failed");
    expect(await readFile(targetPath, "utf8")).toBe(originalSource);
    expect(existsSync(reportPath)).toBe(false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rejects a timed-out mutant when its clean recovery also times out", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "tusk-mutation-recovery-"));
  const targetPath = join(workspace, "target.ts");
  const testPath = join(workspace, "test-runner.ts");
  const poisonPath = join(workspace, "poison");
  const reportPath = join(workspace, "report.json");
  const configPath = join(workspace, "quality.config.json");
  const originalSource = "export const enabled = true;\n";

  try {
    await writeFile(targetPath, originalSource);
    await writeFile(
      testPath,
      `
        import { existsSync } from "node:fs";
        import { readFile, writeFile } from "node:fs/promises";
        const source = await readFile(${JSON.stringify(targetPath)}, "utf8");
        if (source.includes("false")) {
          await writeFile(${JSON.stringify(poisonPath)}, "poisoned");
          await new Promise(() => undefined);
        }
        if (existsSync(${JSON.stringify(poisonPath)})) {
          await new Promise(() => undefined);
        }
      `,
    );
    await writeMutationFixtureConfig({
      configPath,
      reportPath,
      targetPath,
      testPath,
      timeoutMs: 100,
    });

    const result = await runMutationFixture(workspace, configPath, reportPath);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Mutation baseline failed");
    expect(result.stderr).toContain("after timing out");
    expect(await readFile(targetPath, "utf8")).toBe(originalSource);
    expect(existsSync(reportPath)).toBe(false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
