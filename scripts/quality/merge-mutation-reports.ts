import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadQualityConfig } from "./config.js";
import { ensureParentDirectory } from "./files.js";
import {
  buildMutationPlan,
  createMutationReport,
  type MutationReport,
  type Mutant,
  type MutantResult,
} from "./mutation-report.js";

const resultKey = (result: MutantResult) => result.manifestIndex;

const assertReportCounts = (report: MutationReport) => {
  const rebuilt = createMutationReport(report.results, {
    sourceSha: report.sourceSha,
    configHash: report.configHash,
    manifestHash: report.manifestHash,
    manifestTotal: report.manifestTotal,
    shard: report.shard,
    minimumScore: report.minimumScore,
  });
  for (const field of [
    "score",
    "detected",
    "killed",
    "timedOut",
    "survived",
    "total",
  ] as const) {
    if (report[field] !== rebuilt[field]) {
      throw new Error(
        `Mutation shard ${report.shard.index} has an invalid ${field} count`,
      );
    }
  }
};

export const mergeMutationReports = (
  reports: MutationReport[],
  expected: {
    sourceSha: string;
    configHash: string;
    manifestHash: string;
    mutants: Mutant[];
    shardTotal: number;
    minimumScore: number;
  },
): MutationReport => {
  if (reports.length !== expected.shardTotal) {
    throw new Error(
      `Expected ${expected.shardTotal} mutation shard reports, found ${reports.length}`,
    );
  }

  const reportsByIndex = new Map<number, MutationReport>();
  const resultsByIndex = new Map<number, MutantResult>();
  for (const report of reports) {
    if (report.schemaVersion !== 1) {
      throw new Error(
        `Unsupported mutation report schema: ${report.schemaVersion}`,
      );
    }
    if (
      report.sourceSha !== expected.sourceSha ||
      report.configHash !== expected.configHash ||
      report.manifestHash !== expected.manifestHash ||
      report.manifestTotal !== expected.mutants.length ||
      report.shard.total !== expected.shardTotal ||
      report.minimumScore !== expected.minimumScore
    ) {
      throw new Error(
        `Mutation shard ${report.shard.index} does not match the checked-out source and configuration`,
      );
    }
    if (
      !Number.isSafeInteger(report.shard.index) ||
      report.shard.index < 0 ||
      report.shard.index >= expected.shardTotal
    ) {
      throw new Error(`Invalid mutation shard index: ${report.shard.index}`);
    }
    if (reportsByIndex.has(report.shard.index)) {
      throw new Error(`Duplicate mutation shard report: ${report.shard.index}`);
    }
    reportsByIndex.set(report.shard.index, report);
    assertReportCounts(report);

    for (const result of report.results) {
      const key = resultKey(result);
      const expectedMutant = expected.mutants[key];
      const { status: _status, ...reportedMutant } = result;
      if (
        !expectedMutant ||
        JSON.stringify(reportedMutant) !== JSON.stringify(expectedMutant)
      ) {
        throw new Error(`Unexpected mutation result: ${key}`);
      }
      if (key % expected.shardTotal !== report.shard.index) {
        throw new Error(
          `Mutant ${key} was reported by the wrong shard ${report.shard.index}`,
        );
      }
      if (resultsByIndex.has(key)) {
        throw new Error(`Duplicate mutation result: ${key}`);
      }
      resultsByIndex.set(key, result);
    }
  }

  for (let index = 0; index < expected.shardTotal; index += 1) {
    if (!reportsByIndex.has(index)) {
      throw new Error(`Missing mutation shard report: ${index}`);
    }
  }
  if (resultsByIndex.size !== expected.mutants.length) {
    throw new Error(
      `Expected ${expected.mutants.length} mutation results, found ${resultsByIndex.size}`,
    );
  }

  const results: MutantResult[] = [];
  for (let index = 0; index < expected.mutants.length; index += 1) {
    const result = resultsByIndex.get(index);
    if (!result) {
      throw new Error(`Missing mutation result: ${index}`);
    }
    results.push(result);
  }

  const merged = createMutationReport(results, {
    sourceSha: expected.sourceSha,
    configHash: expected.configHash,
    manifestHash: expected.manifestHash,
    manifestTotal: expected.mutants.length,
    shard: { index: 0, total: 1 },
    minimumScore: expected.minimumScore,
  });
  if (merged.score < expected.minimumScore) {
    throw new Error(
      `Mutation score ${merged.score}% is below ${expected.minimumScore}%`,
    );
  }
  return merged;
};

const findJsonFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return await findJsonFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    }),
  );
  return nested.flat().sort();
};

const writeJsonAtomically = async (path: string, value: unknown) => {
  await ensureParentDirectory(path);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2));
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const run = async () => {
  const [reportsDirectory, rawShardTotal] = process.argv.slice(2);
  const shardTotal = Number(rawShardTotal);
  if (
    !reportsDirectory ||
    !Number.isSafeInteger(shardTotal) ||
    shardTotal < 1
  ) {
    throw new Error(
      "Usage: bun scripts/quality/merge-mutation-reports.ts <reports-directory> <shard-total>",
    );
  }

  const config = await loadQualityConfig();
  const plan = await buildMutationPlan(config);
  const reportFiles = await findJsonFiles(reportsDirectory);
  const reports = await Promise.all(
    reportFiles.map(
      async (path) =>
        JSON.parse(await readFile(path, "utf8")) as MutationReport,
    ),
  );
  const report = mergeMutationReports(reports, {
    sourceSha: process.env.GITHUB_SHA ?? "local",
    configHash: plan.configHash,
    manifestHash: plan.manifestHash,
    mutants: plan.mutants.map(
      ({ originalSource: _source, testCommand: _command, ...mutant }) => mutant,
    ),
    shardTotal,
    minimumScore: config.mutation.minimumScore,
  });
  await writeJsonAtomically(config.mutation.reportPath, report);

  console.log(
    `Mutation score: ${report.score}% ` +
      `(${report.detected}/${report.total} detected; ${report.killed} killed, ` +
      `${report.timedOut} timed out)`,
  );
  console.log(`Report: ${config.mutation.reportPath}`);

  if (report.score < config.mutation.minimumScore) {
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  await run();
}
