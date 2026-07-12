import { readFile } from "fs/promises";

export interface QualityConfig {
  crap: {
    lcovPath: string;
    sourceRoots: string[];
    exclude: string[];
    threshold: number;
    reportPath: string;
  };
  mutation: {
    minimumScore: number;
    timeoutMs: number;
    reportPath: string;
    targets: Array<{
      file: string;
      testCommand: string[];
    }>;
  };
}

export const loadQualityConfig = async (
  path = "quality.config.json",
): Promise<QualityConfig> => {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as QualityConfig;
};
