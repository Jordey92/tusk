import { access, readFile } from "fs/promises";
import { isAbsolute, resolve } from "path";
import { pathToFileURL } from "url";
import type { SupportedPostgresDriver } from "../adapters/postgres-client.js";
import { createConfigurationError } from "../utils/errors.js";

export type TuskProjectFileConfig = {
  migrationsPath?: string;
  driver?: SupportedPostgresDriver;
  statementTimeoutMs?: number;
  /** Schema used by `tusk init --from-db` introspection (default: public). */
  schema?: string;
};

type LoadProjectFileConfigOptions = {
  cwd?: string;
  readTextFile?: (path: string) => Promise<string>;
  fileExists?: (path: string) => Promise<boolean>;
  importModule?: (specifier: string) => Promise<unknown>;
};

const CONFIG_FILENAMES = [
  "tusk.config.json",
  "tusk.config.ts",
  "tusk.config.js",
  "tusk.config.mjs",
] as const;

const ALLOWED_KEYS = new Set([
  "migrationsPath",
  "driver",
  "statementTimeoutMs",
  "schema",
]);

const defaultReadTextFile = (path: string) => readFile(path, "utf8");

const defaultFileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const defaultImportModule = (specifier: string) => import(specifier);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDriver = (value: unknown, source: string): SupportedPostgresDriver => {
  if (value === "pg" || value === "postgres") {
    return value;
  }

  throw createConfigurationError(
    `${source}: driver must be either "pg" or "postgres"`,
    { source, driver: String(value) }
  );
};

const parseStatementTimeoutMs = (value: unknown, source: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw createConfigurationError(
      `${source}: statementTimeoutMs must be a non-negative integer`,
      { source, statementTimeoutMs: String(value) }
    );
  }

  return value;
};

const parseNonEmptyString = (
  value: unknown,
  field: string,
  source: string
): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw createConfigurationError(
      `${source}: ${field} must be a non-empty string`,
      { source, field, value: String(value) }
    );
  }

  return value.trim();
};

export const parseProjectFileConfig = (
  value: unknown,
  source: string
): TuskProjectFileConfig => {
  if (!isPlainObject(value)) {
    throw createConfigurationError(
      `${source}: config must be a JSON object`,
      { source }
    );
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw createConfigurationError(
        `${source}: unknown config key "${key}". Allowed keys: ${[
          ...ALLOWED_KEYS,
        ].join(", ")}`,
        { source, key }
      );
    }
  }

  const config: TuskProjectFileConfig = {};

  if (value.migrationsPath !== undefined) {
    config.migrationsPath = parseNonEmptyString(
      value.migrationsPath,
      "migrationsPath",
      source
    );
  }

  if (value.driver !== undefined) {
    config.driver = parseDriver(value.driver, source);
  }

  if (value.statementTimeoutMs !== undefined) {
    config.statementTimeoutMs = parseStatementTimeoutMs(
      value.statementTimeoutMs,
      source
    );
  }

  if (value.schema !== undefined) {
    config.schema = parseNonEmptyString(value.schema, "schema", source);
  }

  return config;
};

const unwrapModuleExport = (moduleExport: unknown): unknown => {
  if (!isPlainObject(moduleExport)) {
    return moduleExport;
  }

  if ("default" in moduleExport) {
    const defaultExport = moduleExport.default;
    if (
      isPlainObject(defaultExport) &&
      "default" in defaultExport &&
      Object.keys(defaultExport).length === 1
    ) {
      return defaultExport.default;
    }
    return defaultExport;
  }

  return moduleExport;
};

const loadJsonConfig = async (
  absolutePath: string,
  readTextFile: (path: string) => Promise<string>
): Promise<TuskProjectFileConfig> => {
  let raw: string;
  try {
    raw = await readTextFile(absolutePath);
  } catch (error) {
    throw createConfigurationError(
      `Failed to read ${absolutePath}`,
      { path: absolutePath, cause: String(error) }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw createConfigurationError(
      `${absolutePath}: invalid JSON (${
        error instanceof Error ? error.message : String(error)
      })`,
      { path: absolutePath }
    );
  }

  return parseProjectFileConfig(parsed, absolutePath);
};

const loadModuleConfig = async (
  absolutePath: string,
  importModule: (specifier: string) => Promise<unknown>
): Promise<TuskProjectFileConfig> => {
  let moduleExport: unknown;
  try {
    moduleExport = await importModule(pathToFileURL(absolutePath).href);
  } catch (error) {
    throw createConfigurationError(
      `Failed to load ${absolutePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { path: absolutePath }
    );
  }

  return parseProjectFileConfig(
    unwrapModuleExport(moduleExport),
    absolutePath
  );
};

type LoadedProjectFileConfig = {
  path: string | null;
  config: TuskProjectFileConfig;
};

/**
 * Load the first project config file found in `cwd`.
 * Search order: tusk.config.json, .ts, .js, .mjs.
 */
export const loadProjectFileConfig = async (
  options: LoadProjectFileConfigOptions = {}
): Promise<LoadedProjectFileConfig> => {
  const cwd = options.cwd ?? process.cwd();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const fileExists = options.fileExists ?? defaultFileExists;
  const importModule = options.importModule ?? defaultImportModule;

  for (const filename of CONFIG_FILENAMES) {
    const absolutePath = resolve(cwd, filename);
    if (!(await fileExists(absolutePath))) {
      continue;
    }

    const config = filename.endsWith(".json")
      ? await loadJsonConfig(absolutePath, readTextFile)
      : await loadModuleConfig(absolutePath, importModule);

    return { path: absolutePath, config };
  }

  return { path: null, config: {} };
};

type ResolveProjectSettingsOptions = {
  /** Explicit migrations path (for example tests calling runCli). Wins over env/file. */
  migrationsPathOverride?: string;
  env?: NodeJS.ProcessEnv;
};

type ResolvedProjectSettings = {
  migrationsPath: string;
  schema: string;
  configPath: string | null;
};

const envValue = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
};

/**
 * Merge file config with environment variables for path/schema defaults.
 * Precedence: explicit override > environment > file > built-in defaults.
 * Driver and statement timeout stay on the raw file config and are applied by
 * `loadDatabaseConfig`, which already treats env as highest priority.
 */
export const resolveProjectSettings = (
  loaded: LoadedProjectFileConfig,
  options: ResolveProjectSettingsOptions = {}
): ResolvedProjectSettings => {
  const env = options.env ?? process.env;
  const file = loaded.config;

  const envMigrationsPath = envValue(env, "MIGRATIONS_PATH");
  let migrationsPath =
    options.migrationsPathOverride ??
    envMigrationsPath ??
    file.migrationsPath ??
    "./migrations";

  if (
    options.migrationsPathOverride === undefined &&
    envMigrationsPath === undefined &&
    file.migrationsPath !== undefined &&
    loaded.path
  ) {
    migrationsPath = resolveMigrationsPathFromConfig(
      file.migrationsPath,
      loaded.path
    );
  }

  const envSchema = envValue(env, "TUSK_SCHEMA");
  const schema = envSchema ?? file.schema ?? "public";

  return {
    migrationsPath,
    schema,
    configPath: loaded.path,
  };
};

/** Resolve a migrations path relative to the config file directory when needed. */
export const resolveMigrationsPathFromConfig = (
  migrationsPath: string,
  configPath: string | null,
  cwd = process.cwd()
): string => {
  if (isAbsolute(migrationsPath)) {
    return migrationsPath;
  }

  const baseDir = configPath ? resolve(configPath, "..") : cwd;
  return resolve(baseDir, migrationsPath);
};
