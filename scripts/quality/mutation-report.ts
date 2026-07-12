import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import ts from "typescript";
import { loadQualityConfig, type QualityConfig } from "./config.js";
import { ensureParentDirectory } from "./files.js";

export type MutantStatus = "killed" | "survived" | "timed-out";

export interface Mutant {
  id: string;
  file: string;
  index: number;
  manifestIndex: number;
  line: number;
  description: string;
  start: number;
  end: number;
  replacement: string;
}

export interface MutantResult extends Mutant {
  status: MutantStatus;
}

export interface MutationShard {
  index: number;
  total: number;
}

export interface MutationReport {
  schemaVersion: 1;
  generatedAt: string;
  sourceSha: string;
  configHash: string;
  manifestHash: string;
  manifestTotal: number;
  shard: MutationShard;
  minimumScore: number;
  score: number;
  detected: number;
  killed: number;
  timedOut: number;
  survived: number;
  total: number;
  survivors: MutantResult[];
  results: MutantResult[];
}

interface PlannedMutant extends Mutant {
  originalSource: string;
  testCommand: string[];
}

interface ActiveMutation {
  file: string;
  originalSource: string;
}

interface ActiveCommand {
  child: ChildProcess;
  exited: Promise<void>;
}

interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

let activeMutation: ActiveMutation | undefined;
let activeCommand: ActiveCommand | undefined;
let restoringBeforeExit = false;

const binaryMutations = new Map<
  ts.SyntaxKind,
  { replacement: string; label: string }
>([
  [
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    { replacement: "!==", label: "strict equality to inequality" },
  ],
  [
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    { replacement: "===", label: "strict inequality to equality" },
  ],
  [
    ts.SyntaxKind.GreaterThanEqualsToken,
    { replacement: ">", label: "greater-or-equal boundary" },
  ],
  [
    ts.SyntaxKind.LessThanEqualsToken,
    { replacement: "<", label: "less-or-equal boundary" },
  ],
  [
    ts.SyntaxKind.GreaterThanToken,
    { replacement: ">=", label: "greater-than boundary" },
  ],
  [
    ts.SyntaxKind.LessThanToken,
    { replacement: "<=", label: "less-than boundary" },
  ],
]);

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const lineForOffset = (sourceFile: ts.SourceFile, offset: number) =>
  sourceFile.getLineAndCharacterOfPosition(offset).line + 1;

const isTypeOnlyBoolean = (node: ts.Node) => ts.isLiteralTypeNode(node.parent);

export const collectMutants = (file: string, source: string): Mutant[] => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const discovered: Omit<Mutant, "id" | "index" | "manifestIndex">[] = [];

  const addMutant = (
    node: ts.Node,
    replacement: string,
    description: string,
  ) => {
    const start = node.getStart(sourceFile);
    discovered.push({
      file,
      line: lineForOffset(sourceFile, start),
      description,
      start,
      end: node.getEnd(),
      replacement,
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node)) {
      const mutation = binaryMutations.get(node.operatorToken.kind);
      if (mutation) {
        addMutant(node.operatorToken, mutation.replacement, mutation.label);
      }
    } else if (
      node.kind === ts.SyntaxKind.TrueKeyword &&
      !isTypeOnlyBoolean(node)
    ) {
      addMutant(node, "false", "true to false");
    } else if (
      node.kind === ts.SyntaxKind.FalseKeyword &&
      !isTypeOnlyBoolean(node)
    ) {
      addMutant(node, "true", "false to true");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return discovered
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((mutant, index) => ({
      ...mutant,
      id: "",
      index: index + 1,
      manifestIndex: -1,
    }));
};

const applyMutant = (source: string, mutant: Mutant) =>
  source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);

export const resolveMutationShard = (
  environment: Record<string, string | undefined> = process.env,
): MutationShard => {
  const rawIndex = environment.TUSK_MUTATION_SHARD_INDEX;
  const rawTotal = environment.TUSK_MUTATION_SHARD_TOTAL;

  if (rawIndex === undefined && rawTotal === undefined) {
    return { index: 0, total: 1 };
  }
  if (rawIndex === undefined || rawTotal === undefined) {
    throw new Error(
      "TUSK_MUTATION_SHARD_INDEX and TUSK_MUTATION_SHARD_TOTAL must be set together",
    );
  }

  const index = Number(rawIndex);
  const total = Number(rawTotal);
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new Error("TUSK_MUTATION_SHARD_TOTAL must be a positive integer");
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= total) {
    throw new Error(
      "TUSK_MUTATION_SHARD_INDEX must be an integer from zero to shard total minus one",
    );
  }

  return { index, total };
};

const configFingerprint = (config: QualityConfig) =>
  sha256(
    JSON.stringify({
      minimumScore: config.mutation.minimumScore,
      timeoutMs: config.mutation.timeoutMs,
      targets: config.mutation.targets,
    }),
  );

export const buildMutationPlan = async (
  config: QualityConfig,
  requestedFiles?: Set<string>,
): Promise<{
  configHash: string;
  manifestHash: string;
  mutants: PlannedMutant[];
}> => {
  const targets =
    requestedFiles && requestedFiles.size > 0
      ? config.mutation.targets.filter((target) =>
          requestedFiles.has(target.file),
        )
      : config.mutation.targets;

  if (
    requestedFiles &&
    requestedFiles.size > 0 &&
    targets.length !== requestedFiles.size
  ) {
    const configuredTargets = new Set(
      config.mutation.targets.map((target) => target.file),
    );
    const unknownTargets = [...requestedFiles].filter(
      (target) => !configuredTargets.has(target),
    );
    throw new Error(`Unknown mutation target(s): ${unknownTargets.join(", ")}`);
  }

  const planned: PlannedMutant[] = [];
  for (const target of targets) {
    const originalSource = await readFile(target.file, "utf-8");
    for (const mutant of collectMutants(target.file, originalSource)) {
      const descriptor = {
        file: mutant.file,
        index: mutant.index,
        line: mutant.line,
        description: mutant.description,
        start: mutant.start,
        end: mutant.end,
        replacement: mutant.replacement,
      };
      planned.push({
        ...mutant,
        id: sha256(JSON.stringify(descriptor)),
        manifestIndex: planned.length,
        originalSource,
        testCommand: target.testCommand,
      });
    }
  }

  const manifestHash = sha256(
    JSON.stringify(
      planned.map(
        ({
          originalSource: _originalSource,
          testCommand: _testCommand,
          ...mutant
        }) => mutant,
      ),
    ),
  );

  return {
    configHash: configFingerprint(config),
    manifestHash,
    mutants: planned,
  };
};

export const selectMutationShard = <T extends { manifestIndex: number }>(
  mutants: T[],
  shard: MutationShard,
) =>
  mutants.filter(
    (mutant) => mutant.manifestIndex % shard.total === shard.index,
  );

const terminateProcessTree = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (!child.pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
};

const stopActiveCommand = async () => {
  if (!activeCommand) {
    return;
  }

  const commandToStop = activeCommand;
  terminateProcessTree(commandToStop.child, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 250));
  terminateProcessTree(commandToStop.child, "SIGKILL");
  await commandToStop.exited;
  if (activeCommand === commandToStop) {
    activeCommand = undefined;
  }
};

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
  stopActiveCommand()
    .then(restoreActiveMutation)
    .catch((error) => {
      console.error(
        `Failed to stop mutation testing cleanly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    })
    .finally(() => process.exit(exitCode));
};

process.once("SIGINT", () => restoreAndExit(130));
process.once("SIGTERM", () => restoreAndExit(143));
process.once("SIGHUP", () => restoreAndExit(129));

const runCommand = async (
  command: string[],
  timeoutMs: number,
  captureOutput = false,
): Promise<CommandResult> => {
  const child = spawn(command[0], command.slice(1), {
    detached: process.platform !== "win32",
    env: process.env,
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

  let resolveExit: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const completed = new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolveExit();
      resolve({ exitCode, signal });
    });
  });

  const commandState = { child, exited };
  activeCommand = commandState;
  let timedOut = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveTermination: () => void = () => undefined;
  const terminationComplete = new Promise<void>((resolve) => {
    resolveTermination = resolve;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    if (process.platform === "win32") {
      terminateProcessTree(child, "SIGKILL");
      resolveTermination();
    } else {
      terminateProcessTree(child, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        terminateProcessTree(child, "SIGKILL");
        resolveTermination();
      }, 250);
    }
  }, timeoutMs);

  try {
    const result = await completed;
    if (timedOut) {
      await terminationComplete;
    }
    return {
      ...result,
      timedOut,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    };
  } finally {
    clearTimeout(timeout);
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
    }
    if (activeCommand === commandState) {
      activeCommand = undefined;
    }
  }
};

const verifyBaseline = async (
  file: string,
  command: string[],
  timeoutMs: number,
) => {
  const result = await runCommand(command, timeoutMs, true);
  if (result.timedOut || result.exitCode !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(
      `Mutation baseline failed for ${file} (${command.join(" ")})` +
        `${result.timedOut ? " after timing out" : ""}` +
        `${output ? `\n${output}` : ""}`,
    );
  }
};

const testMutant = async (
  mutant: PlannedMutant,
  timeoutMs: number,
): Promise<MutantResult> => {
  activeMutation = {
    file: mutant.file,
    originalSource: mutant.originalSource,
  };
  await writeFile(mutant.file, applyMutant(mutant.originalSource, mutant));

  try {
    const commandResult = await runCommand(mutant.testCommand, timeoutMs);
    const {
      originalSource: _originalSource,
      testCommand: _testCommand,
      ...reportMutant
    } = mutant;

    return {
      ...reportMutant,
      status: commandResult.timedOut
        ? "timed-out"
        : commandResult.exitCode === 0
          ? "survived"
          : "killed",
    };
  } finally {
    await restoreActiveMutation();
  }
};

export const createMutationReport = (
  results: MutantResult[],
  metadata: {
    sourceSha: string;
    configHash: string;
    manifestHash: string;
    manifestTotal: number;
    shard: MutationShard;
    minimumScore: number;
  },
): MutationReport => {
  const killed = results.filter((result) => result.status === "killed").length;
  const timedOut = results.filter(
    (result) => result.status === "timed-out",
  ).length;
  const survived = results.filter(
    (result) => result.status === "survived",
  ).length;
  const detected = killed + timedOut;
  const score = results.length === 0 ? 100 : (detected / results.length) * 100;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...metadata,
    score: Number(score.toFixed(2)),
    detected,
    killed,
    timedOut,
    survived,
    total: results.length,
    survivors: results.filter((result) => result.status === "survived"),
    results,
  };
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
  const config = await loadQualityConfig(process.env.TUSK_QUALITY_CONFIG_PATH);
  const requestedFiles = new Set(process.argv.slice(2));
  const shard = resolveMutationShard();
  const plan = await buildMutationPlan(config, requestedFiles);
  const selectedMutants = selectMutationShard(plan.mutants, shard);
  const selectedTargets = new Map<string, PlannedMutant>();
  for (const mutant of selectedMutants) {
    selectedTargets.set(mutant.file, mutant);
  }

  console.log(
    `Mutation shard ${shard.index + 1}/${shard.total}: ` +
      `${selectedMutants.length}/${plan.mutants.length} mutant(s)`,
  );
  for (const mutant of selectedTargets.values()) {
    console.log(`Baseline: ${mutant.file}`);
    await verifyBaseline(
      mutant.file,
      mutant.testCommand,
      config.mutation.timeoutMs,
    );
  }

  const results: MutantResult[] = [];
  for (const mutant of selectedMutants) {
    const result = await testMutant(mutant, config.mutation.timeoutMs);
    results.push(result);
    console.log(
      `  ${result.status.padEnd(9)} ${result.file}:${result.line} ` +
        `[${result.manifestIndex}] ${result.description}`,
    );
    if (result.status === "timed-out") {
      console.log(`Recovery baseline: ${mutant.file}`);
      await verifyBaseline(
        mutant.file,
        mutant.testCommand,
        config.mutation.timeoutMs,
      );
    }
  }

  for (const mutant of selectedTargets.values()) {
    console.log(`Final baseline: ${mutant.file}`);
    await verifyBaseline(
      mutant.file,
      mutant.testCommand,
      config.mutation.timeoutMs,
    );
  }

  const report = createMutationReport(results, {
    sourceSha: process.env.GITHUB_SHA ?? "local",
    configHash: plan.configHash,
    manifestHash: plan.manifestHash,
    manifestTotal: plan.mutants.length,
    shard,
    minimumScore: config.mutation.minimumScore,
  });
  const reportPath =
    process.env.TUSK_MUTATION_REPORT_PATH ?? config.mutation.reportPath;
  await writeJsonAtomically(reportPath, report);

  console.log("");
  console.log(
    `Mutation score: ${report.score}% ` +
      `(${report.detected}/${report.total} detected; ${report.killed} killed, ` +
      `${report.timedOut} timed out)`,
  );
  console.log(`Report: ${reportPath}`);

  if (shard.total === 1 && report.score < config.mutation.minimumScore) {
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  await run();
}
