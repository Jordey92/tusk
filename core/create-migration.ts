import { mkdir, rm, writeFile } from "fs/promises";
import { dirname, isAbsolute, relative, resolve } from "path";
import { downTemplate, upTemplate } from "../templates/migrationContent.js";
import {
  createMigrationFileError,
  createValidationError,
  toError,
} from "../utils/errors.js";

const MIGRATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_FILENAME_BYTES = 255;
const MAX_TIMESTAMP_ATTEMPTS = 20;
let lastAllocatedTimestamp = 0;

const validateMigrationName = (name: string) => {
  if (!name) {
    throw createValidationError("Migration name is required", { name });
  }

  if (!MIGRATION_NAME_PATTERN.test(name)) {
    throw createValidationError(
      "Migration name must start with a letter or number and contain only letters, numbers, underscores, or hyphens",
      { name }
    );
  }

  return name;
};

const isContainedPath = (root: string, candidate: string) => {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot.length > 0 &&
    !pathFromRoot.startsWith("..") &&
    !isAbsolute(pathFromRoot) &&
    dirname(candidate) === root
  );
};

const assertSafeFilename = (
  migrationsPath: string,
  filename: string
) => {
  if (Buffer.byteLength(filename, "utf8") > MAX_FILENAME_BYTES) {
    throw createValidationError(
      `Migration filename exceeds the ${MAX_FILENAME_BYTES}-byte filesystem and metadata limit`,
      { filename, maxBytes: MAX_FILENAME_BYTES }
    );
  }

  const candidate = resolve(migrationsPath, filename);
  if (!isContainedPath(migrationsPath, candidate)) {
    throw createValidationError(
      "Migration filename must remain directly inside the migrations directory",
      { filename, migrationsPath }
    );
  }

  return candidate;
};

const allocateTimestamp = () => {
  const timestamp = Math.max(Date.now(), lastAllocatedTimestamp + 1);
  lastAllocatedTimestamp = timestamp;
  return timestamp.toString();
};

const removeCreatedPair = async (
  upPath: string,
  downPath: string,
  created: { up: boolean; down: boolean }
) => {
  await Promise.all([
    created.up ? rm(upPath, { force: true }) : Promise.resolve(),
    created.down ? rm(downPath, { force: true }) : Promise.resolve(),
  ]);
};

export const createMigrationFile = async (
  migrationsPath: string,
  filename: string
): Promise<{ upFile: string; downFile: string }> => {
  validateMigrationName(filename);
  const path = resolve(migrationsPath);
  await mkdir(path, { recursive: true });

  for (let attempt = 0; attempt < MAX_TIMESTAMP_ATTEMPTS; attempt++) {
    const timestamp = allocateTimestamp();
    const upFilename = `${timestamp}_${filename}.up.sql`;
    const downFilename = `${timestamp}_${filename}.down.sql`;
    const upPath = assertSafeFilename(path, upFilename);
    const downPath = assertSafeFilename(path, downFilename);
    const claimPath = assertSafeFilename(
      path,
      `.tusk-create-${timestamp}.lock`
    );
    const created = { up: false, down: false };

    try {
      await writeFile(claimPath, "", { flag: "wx" });
      try {
        await writeFile(upPath, upTemplate(filename), { flag: "wx" });
        created.up = true;
        await writeFile(downPath, downTemplate(filename), { flag: "wx" });
        created.down = true;
        return { upFile: upFilename, downFile: downFilename };
      } finally {
        await rm(claimPath, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
      if (code === "EEXIST") {
        await removeCreatedPair(upPath, downPath, created);
        continue;
      }

      await removeCreatedPair(upPath, downPath, created);
      throw createMigrationFileError(filename, "Migration files could not be created", toError(error));
    }
  }

  throw createMigrationFileError(
    filename,
    "Could not allocate a unique migration timestamp; retry the command"
  );
};
