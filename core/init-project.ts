import { access, mkdir } from "fs/promises";
import { resolve } from "path";
import { isMissingPathError } from "../utils/fs-errors.js";

export interface InitProjectResult {
  migrationsPath: string;
  absolutePath: string;
  created: boolean;
}

const pathExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }

    return false;
  }
};

export const initializeProject = async (
  migrationsPath: string
): Promise<InitProjectResult> => {
  const absolutePath = resolve(migrationsPath);
  const existed = await pathExists(absolutePath);

  await mkdir(absolutePath, { recursive: true });

  return {
    migrationsPath,
    absolutePath,
    created: !existed,
  };
};
