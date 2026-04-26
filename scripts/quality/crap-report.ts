import { readFile, writeFile } from "fs/promises";
import { loadQualityConfig } from "./config.js";
import { getFunctionComplexities } from "./complexity.js";
import { ensureParentDirectory, listTypeScriptFiles, matchesSimplePattern } from "./files.js";
import { getSpanCoverage, parseLcov } from "./lcov.js";

interface CrapEntry {
  file: string;
  functionName: string;
  startLine: number;
  endLine: number;
  complexity: number;
  coverage: number;
  executableLines: number;
  coveredLines: number;
  crap: number;
}

const calculateCrap = (complexity: number, coverage: number) =>
  complexity ** 2 * (1 - coverage) ** 3 + complexity;

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const run = async () => {
  const config = await loadQualityConfig();
  const coverage = await parseLcov(config.crap.lcovPath);
  const sourceFiles = (await listTypeScriptFiles(config.crap.sourceRoots)).filter(
    (file) => !config.crap.exclude.some((pattern) => matchesSimplePattern(file, pattern))
  );
  const entries: CrapEntry[] = [];

  for (const file of sourceFiles) {
    const sourceText = await readFile(file, "utf-8");

    for (const fn of getFunctionComplexities(file, sourceText)) {
      const spanCoverage = getSpanCoverage(
        coverage,
        file,
        fn.startLine,
        fn.endLine
      );

      if (spanCoverage.executableLines === 0) {
        continue;
      }

      entries.push({
        file,
        functionName: fn.name,
        startLine: fn.startLine,
        endLine: fn.endLine,
        complexity: fn.complexity,
        coverage: spanCoverage.coverage,
        executableLines: spanCoverage.executableLines,
        coveredLines: spanCoverage.coveredLines,
        crap: Number(calculateCrap(fn.complexity, spanCoverage.coverage).toFixed(2)),
      });
    }
  }

  entries.sort((a, b) => b.crap - a.crap);
  const violations = entries.filter((entry) => entry.crap > config.crap.threshold);
  const report = {
    threshold: config.crap.threshold,
    generatedAt: new Date().toISOString(),
    violations,
    entries,
  };

  await ensureParentDirectory(config.crap.reportPath);
  await writeFile(config.crap.reportPath, JSON.stringify(report, null, 2));

  console.log(`CRAP threshold: ${config.crap.threshold}`);
  console.log(`Analyzed functions: ${entries.length}`);
  console.log(`Violations: ${violations.length}`);
  console.log("");
  console.log("Top CRAP scores:");

  for (const entry of entries.slice(0, 10)) {
    console.log(
      `${entry.crap.toFixed(2).padStart(6)}  ` +
        `C${entry.complexity.toString().padEnd(2)}  ` +
        `${formatPercent(entry.coverage).padStart(6)}  ` +
        `${entry.file}:${entry.startLine} ${entry.functionName}`
    );
  }

  console.log(`\nReport: ${config.crap.reportPath}`);

  if (violations.length > 0) {
    process.exit(1);
  }
};

await run();
