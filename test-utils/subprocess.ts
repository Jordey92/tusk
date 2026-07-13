import {
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";

interface TestSubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface TestSubprocessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  windowsVerbatimArguments?: boolean;
}

export class TestSubprocessTimeoutError extends Error {
  constructor(
    readonly command: string[],
    readonly timeoutMs: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(
      `Test subprocess timed out after ${timeoutMs}ms: ${command.join(" ")}` +
        `${stdout ? `\nstdout:\n${stdout}` : ""}` +
        `${stderr ? `\nstderr:\n${stderr}` : ""}`,
    );
    this.name = "TestSubprocessTimeoutError";
  }
}

const cleanupGraceMs = 250;

const waitForProcessClose = async (
  closedPromise: Promise<number>,
  timeoutMs: number,
) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      closedPromise,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const descendantProcessIds = (rootPid: number): number[] => {
  if (process.platform === "win32") {
    return [];
  }

  const result = spawnSync("ps", ["-eo", "pid=,ppid="], {
    encoding: "utf8",
    timeout: cleanupGraceMs,
  });
  if (result.status !== 0) {
    return [];
  }

  const childrenByParent = new Map<number, number[]>();
  for (const line of result.stdout.split("\n")) {
    const [rawPid, rawParentPid] = line.trim().split(/\s+/);
    const pid = Number(rawPid);
    const parentPid = Number(rawParentPid);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parentPid)) {
      continue;
    }

    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }

  const descendants: number[] = [];
  const visit = (parentPid: number) => {
    for (const pid of childrenByParent.get(parentPid) ?? []) {
      visit(pid);
      descendants.push(pid);
    }
  };
  visit(rootPid);
  return descendants;
};

const signalDescendants = (
  descendantPids: number[],
  signal: NodeJS.Signals,
) => {
  for (const pid of descendantPids) {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may have exited while the tree was being terminated.
    }
  }
};

const signalRootProcessTree = (
  child: ChildProcess,
  signal: NodeJS.Signals,
) => {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      timeout: cleanupGraceMs,
    });
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
};

const terminateTimedOutTree = async (
  child: ChildProcess,
  closed: () => boolean,
  closedPromise: Promise<number>,
) => {
  if (!child.pid) {
    return;
  }

  const descendants = descendantProcessIds(child.pid);
  signalDescendants(descendants, "SIGTERM");
  signalRootProcessTree(child, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, cleanupGraceMs));
  signalDescendants(descendants, "SIGKILL");

  if (process.platform !== "win32" || !closed()) {
    signalRootProcessTree(child, "SIGKILL");
  }
  if (!closed()) {
    await waitForProcessClose(closedPromise, cleanupGraceMs);
  }
};

const forceTerminateTree = async (
  child: ChildProcess,
  closed: () => boolean,
  closedPromise: Promise<number>,
) => {
  if (!child.pid || closed()) {
    return;
  }

  const descendants = descendantProcessIds(child.pid);
  signalDescendants(descendants, "SIGKILL");
  signalRootProcessTree(child, "SIGKILL");
  await waitForProcessClose(closedPromise, cleanupGraceMs);
};

export const runTestSubprocess = async (
  command: string[],
  options: TestSubprocessOptions,
): Promise<TestSubprocessResult> => {
  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    windowsVerbatimArguments: options.windowsVerbatimArguments,
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  const stdinErrorPromise = new Promise<never>((_resolve, reject) => {
    child.stdin?.once("error", (error) => {
      reject(new Error("Test subprocess stdin failed", { cause: error }));
    });
  });
  child.stdin?.end(options.stdin ?? "");

  let closed = false;
  const closedPromise = new Promise<number>((resolve) => {
    child.once("close", (code) => {
      closed = true;
      resolve(code ?? 1);
    });
  });
  const errorPromise = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
  });
  type Outcome =
    | { kind: "closed"; exitCode: number }
    | { kind: "timeout" };
  const outcomes: Array<Promise<Outcome>> = [
    closedPromise.then((exitCode) => ({ kind: "closed", exitCode })),
    errorPromise,
    stdinErrorPromise,
  ];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  outcomes.push(
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ kind: "timeout" }), options.timeoutMs);
    }),
  );

  let timedOut = false;
  let exitCode = -1;
  try {
    const outcome = await Promise.race(outcomes);
    if (outcome.kind === "timeout") {
      timedOut = true;
    } else {
      exitCode = outcome.exitCode;
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (timedOut) {
      await terminateTimedOutTree(child, () => closed, closedPromise);
    } else if (!closed) {
      await forceTerminateTree(child, () => closed, closedPromise);
    }
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  if (timedOut) {
    throw new TestSubprocessTimeoutError(
      command,
      options.timeoutMs,
      stdout,
      stderr,
    );
  }

  return {
    exitCode,
    stdout,
    stderr,
  };
};
