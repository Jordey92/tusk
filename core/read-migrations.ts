import { readdir, readFile, access } from "fs/promises";
import { resolve } from "path";
import type { Migration } from "../types/migrations.js";
import { createMigrationDirectoryError, createMigrationFileError, formatTuskError } from "../utils/errors.js";

const UP_DOWN_REGEX = /\.(up|down)\.sql$/;

export const getFilesFromDirectory = async (path: string) => {
  const absolutePath = resolve(path);

  try {
    await access(absolutePath);
  } catch (error) {
    const tuskError = createMigrationDirectoryError(
      absolutePath,
      error instanceof Error ? error : new Error(String(error))
    );
    throw tuskError;
  }

  const files = await readdir(absolutePath);
  return files;
};

export const getSqlFilesFromList = (
  files: string[],
  direction: "up" | "down" = "up"
) => {
  return files.filter((file) => file.endsWith(`${direction}.sql`));
};

export const extractTimestampFromFilename = (filename: string): string => {
  if (!filename.match(UP_DOWN_REGEX)) {
    const tuskError = createMigrationFileError(filename, "Filename must end with .up.sql or .down.sql");
    throw tuskError;
  }

  const [timestamp, ..._] = filename
    .replace(UP_DOWN_REGEX, "")
    .split("_");

  if (!timestamp) {
    const tuskError = createMigrationFileError(filename, "No timestamp found in filename");
    throw tuskError;
  }

  return timestamp;
};

export const readSqlFile = async (path: string, filename: string) => {
  const absolutePath = resolve(path, filename);
  const sql = await readFile(absolutePath, "utf-8");
  return sql;
};

export const sortMigrationsByTimestamp = (migrations: string[]) => {
  return migrations.sort((a, b) => {
    const aTimestamp = extractTimestampFromFilename(a);
    const bTimestamp = extractTimestampFromFilename(b);
    return Number(aTimestamp) - Number(bTimestamp);
  });
};

export const readMigrations = async (
  path: string,
  direction: "up" | "down" = "up"
): Promise<Migration[]> => {
  const files = await getFilesFromDirectory(path);
  const sqlFiles = getSqlFilesFromList(files, direction);
  const sortedMigrations = sortMigrationsByTimestamp(sqlFiles);

  const migrations = await Promise.all(
    sortedMigrations.map(async (filename) => {
      const timestamp = extractTimestampFromFilename(filename);
      const sql = await readSqlFile(path, filename);
      return { filename, timestamp, sql };
    })
  );

  return migrations;
};
