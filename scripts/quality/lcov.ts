import { readFile } from "fs/promises";

interface FileCoverage {
  lines: Map<number, number>;
}

type CoverageMap = Map<string, FileCoverage>;

export const parseLcov = async (path: string): Promise<CoverageMap> => {
  const raw = await readFile(path, "utf-8");
  const coverage = new Map<string, FileCoverage>();
  let currentFile: string | undefined;
  let currentLines = new Map<number, number>();

  const flush = () => {
    if (!currentFile) {
      return;
    }

    coverage.set(currentFile, { lines: currentLines });
    currentFile = undefined;
    currentLines = new Map();
  };

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      flush();
      currentFile = line.slice(3);
      continue;
    }

    if (line.startsWith("DA:")) {
      const [lineNumber, hits] = line.slice(3).split(",");
      if (lineNumber && hits) {
        currentLines.set(Number(lineNumber), Number(hits));
      }
      continue;
    }

    if (line === "end_of_record") {
      flush();
    }
  }

  flush();
  return coverage;
};

export const getSpanCoverage = (
  coverage: CoverageMap,
  filePath: string,
  startLine: number,
  endLine: number
) => {
  const fileCoverage = coverage.get(filePath);

  if (!fileCoverage) {
    return {
      coveredLines: 0,
      executableLines: 0,
      coverage: 0,
    };
  }

  let executableLines = 0;
  let coveredLines = 0;

  for (const [line, hits] of fileCoverage.lines.entries()) {
    if (line < startLine || line > endLine) {
      continue;
    }

    executableLines++;
    if (hits > 0) {
      coveredLines++;
    }
  }

  return {
    coveredLines,
    executableLines,
    coverage: executableLines === 0 ? 1 : coveredLines / executableLines,
  };
};
