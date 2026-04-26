import { readFile, writeFile } from "fs/promises";
import { loadQualityConfig } from "./config.js";
import { ensureParentDirectory } from "./files.js";

type MutantStatus = "killed" | "survived" | "timed-out";

interface Mutant {
  file: string;
  index: number;
  line: number;
  description: string;
  start: number;
  end: number;
  replacement: string;
}

interface MutantResult extends Mutant {
  status: MutantStatus;
}

interface ActiveMutation {
  file: string;
  originalSource: string;
}

let activeMutation: ActiveMutation | undefined;
let restoringBeforeExit = false;

const mutationPatterns: Array<{
  pattern: RegExp;
  replacement: string;
  label: string;
}> = [
  { pattern: /===/g, replacement: "!==", label: "strict equality to inequality" },
  { pattern: /!==/g, replacement: "===", label: "strict inequality to equality" },
  { pattern: />=/g, replacement: ">", label: "greater-or-equal boundary" },
  { pattern: /<=/g, replacement: "<", label: "less-or-equal boundary" },
  { pattern: />/g, replacement: ">=", label: "greater-than boundary" },
  { pattern: /</g, replacement: "<=", label: "less-than boundary" },
  { pattern: /\btrue\b/g, replacement: "false", label: "true to false" },
  { pattern: /\bfalse\b/g, replacement: "true", label: "false to true" }
];

const lineForOffset = (source: string, offset: number) =>
  source.slice(0, offset).split(/\r?\n/).length;

const overlapsExistingMutant = (mutants: Mutant[], start: number, end: number) =>
  mutants.some((mutant) => start < mutant.end && end > mutant.start);

const collectMutants = (
  file: string,
  source: string,
  maxMutants: number
): Mutant[] => {
  const mutants: Mutant[] = [];

  for (const mutationPattern of mutationPatterns) {
    for (const match of source.matchAll(mutationPattern.pattern)) {
      if (match.index === undefined || match[0] === mutationPattern.replacement) {
        continue;
      }

      const start = match.index;
      const end = start + match[0].length;

      if (overlapsExistingMutant(mutants, start, end)) {
        continue;
      }

      mutants.push({
        file,
        index: mutants.length + 1,
        line: lineForOffset(source, start),
        description: mutationPattern.label,
        start,
        end,
        replacement: mutationPattern.replacement,
      });

      if (mutants.length >= maxMutants) {
        return mutants;
      }
    }
  }

  return mutants;
};

const applyMutant = (source: string, mutant: Mutant) =>
  source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);

const restoreActiveMutation = async () => {
  if (!activeMutation) {
    return;
  }

  const mutationToRestore = activeMutation;
  activeMutation = undefined;
  await writeFile(mutationToRestore.file, mutationToRestore.originalSource);
};

const restoreAndExit = (exitCode: number) => {
  if (restoringBeforeExit) {
    return;
  }

  restoringBeforeExit = true;
  restoreActiveMutation()
    .catch((error) => {
      console.error(
        `Failed to restore active mutant: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    })
    .finally(() => process.exit(exitCode));
};

process.once("SIGINT", () => restoreAndExit(130));
process.once("SIGTERM", () => restoreAndExit(143));
process.once("SIGHUP", () => restoreAndExit(129));

const runCommand = async (command: string, timeoutMs: number) => {
  const child = Bun.spawn(["bash", "-lc", command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill(), timeoutMs);

  try {
    const exitCode = await child.exited;
    return exitCode;
  } finally {
    clearTimeout(timeout);
  }
};

const testMutant = async (
  mutant: Mutant,
  originalSource: string,
  testCommand: string,
  timeoutMs: number
): Promise<MutantResult> => {
  activeMutation = {
    file: mutant.file,
    originalSource,
  };
  await writeFile(mutant.file, applyMutant(originalSource, mutant));

  try {
    const exitCode = await runCommand(testCommand, timeoutMs);

    return {
      ...mutant,
      status: exitCode === 0 ? "survived" : "killed",
    };
  } finally {
    await restoreActiveMutation();
  }
};

const run = async () => {
  const config = await loadQualityConfig();
  const results: MutantResult[] = [];

  for (const target of config.mutation.targets) {
    const originalSource = await readFile(target.file, "utf-8");
    const mutants = collectMutants(
      target.file,
      originalSource,
      config.mutation.maxMutantsPerFile
    );

    console.log(`${target.file}: ${mutants.length} mutant(s)`);

    for (const mutant of mutants) {
      const result = await testMutant(
        mutant,
        originalSource,
        target.testCommand,
        config.mutation.timeoutMs
      );
      results.push(result);
      console.log(
        `  ${result.status.padEnd(8)} line ${result.line}: ${result.description}`
      );
    }
  }

  const killed = results.filter((result) => result.status === "killed").length;
  const survived = results.filter((result) => result.status === "survived").length;
  const mutationScore = results.length === 0 ? 100 : (killed / results.length) * 100;
  const report = {
    generatedAt: new Date().toISOString(),
    minimumScore: config.mutation.minimumScore,
    score: Number(mutationScore.toFixed(2)),
    killed,
    survived,
    total: results.length,
    survivors: results.filter((result) => result.status === "survived"),
    results,
  };

  await ensureParentDirectory(config.mutation.reportPath);
  await writeFile(config.mutation.reportPath, JSON.stringify(report, null, 2));

  console.log("");
  console.log(
    `Mutation score: ${report.score}% (${killed}/${results.length} killed)`
  );
  console.log(`Report: ${config.mutation.reportPath}`);

  if (report.score < config.mutation.minimumScore) {
    process.exit(1);
  }
};

await run();
