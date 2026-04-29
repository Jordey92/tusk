import { mkdir, readdir, stat } from "fs/promises";
import { dirname, join } from "path";

export const ensureParentDirectory = async (filePath: string) => {
  await mkdir(dirname(filePath), { recursive: true });
};

export const listTypeScriptFiles = async (roots: string[]): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (path: string) => {
    const pathStat = await stat(path);
    if (pathStat.isFile()) {
      if (path.endsWith(".ts")) {
        files.push(path);
      }

      return;
    }

    const entries = await readdir(path, { withFileTypes: true });

    for (const entry of entries) {
      const childPath = join(path, entry.name);

      if (entry.isDirectory()) {
        await walk(childPath);
        continue;
      }

      if (entry.isFile() && childPath.endsWith(".ts")) {
        files.push(childPath);
      }
    }
  };

  for (const root of roots) {
    await walk(root);
  }

  return files.sort();
};

export const matchesSimplePattern = (filePath: string, pattern: string) => {
  if (pattern === "**/*.test.ts") {
    return filePath.endsWith(".test.ts");
  }

  return filePath === pattern;
};
