import { access, readFile } from "fs/promises";
import { dirname, resolve } from "path";
import { constants } from "fs";

const isMissingFileError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
};

const findPackageJson = async (startDir: string): Promise<string | null> => {
  let currentDir = startDir;

  while (true) {
    const candidate = resolve(currentDir, "package.json");
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
};

export const getPackageVersion = async (startDir: string): Promise<string> => {
  const packageJsonPath = await findPackageJson(startDir);
  if (!packageJsonPath) {
    return "unknown";
  }

  const raw = await readFile(packageJsonPath, "utf-8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version || "unknown";
};
