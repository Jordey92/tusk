import { readFile } from "fs/promises";
import { dirname, resolve } from "path";

const findPackageJson = async (startDir: string): Promise<string | null> => {
  let currentDir = startDir;

  while (true) {
    const candidate = resolve(currentDir, "package.json");
    try {
      await readFile(candidate, "utf-8");
      return candidate;
    } catch {}

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
};

export const getPackageVersion = async (startDir: string): Promise<string> => {
  try {
    const packageJsonPath = await findPackageJson(startDir);
    if (!packageJsonPath) {
      return "unknown";
    }

    const raw = await readFile(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || "unknown";
  } catch {
    return "unknown";
  }
};
