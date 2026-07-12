import { readdir, readFile, access } from "fs/promises";
import { resolve } from "path";
import type { Migration } from "../types/migrations.js";
import {
  createMigrationDirectoryError,
  createMigrationFileError,
  toError,
} from "../utils/errors.js";

const UP_DOWN_REGEX = /^(\d+)(?:_.+)?\.(up|down)\.sql$/;

export const getFilesFromDirectory = async (path: string) => {
  const absolutePath = resolve(path);

  try {
    await access(absolutePath);
  } catch (error) {
    const tuskError = createMigrationDirectoryError(absolutePath, toError(error));
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
  const match = filename.match(UP_DOWN_REGEX);
  if (!match) {
    const tuskError = createMigrationFileError(
      filename,
      "Filename must start with a numeric timestamp and end with .up.sql or .down.sql"
    );
    throw tuskError;
  }

  const timestamp = match[1];

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
    const aTimestamp = BigInt(extractTimestampFromFilename(a));
    const bTimestamp = BigInt(extractTimestampFromFilename(b));
    return aTimestamp < bTimestamp ? -1 : aTimestamp > bTimestamp ? 1 : 0;
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
