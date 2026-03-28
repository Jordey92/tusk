import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import { downTemplate, upTemplate } from "../templates/migrationContent.js";

export const createMigrationFile = async (
  migrationsPath: string,
  filename: string
): Promise<{ upFile: string; downFile: string }> => {
  const timestamp = Date.now();
  const upFilename = `${timestamp}_${filename}.up.sql`;
  const downFilename = `${timestamp}_${filename}.down.sql`;

  const path = resolve(migrationsPath);
  const upPath = resolve(path, upFilename);
  const downPath = resolve(path, downFilename);

  await mkdir(path, { recursive: true });
  await writeFile(upPath, upTemplate(filename));
  await writeFile(downPath, downTemplate(filename));

  return { upFile: upFilename, downFile: downFilename };
};
