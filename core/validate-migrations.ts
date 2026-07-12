import { access, readdir, readFile } from "fs/promises";
import { resolve } from "path";
import type { Migration, MigrationAdapter } from "../types/migrations.js";
import type { StructuredContext } from "../types/structured.js";
import { calculateChecksum } from "../utils/checksum.js";
import { isMissingPathError } from "../utils/fs-errors.js";
import {
  createMigrationDirectoryError,
  createValidationError,
} from "../utils/errors.js";
import { getExecutedMigrationRecordsReadOnly } from "./migration-records.js";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue extends StructuredContext {
  severity: ValidationSeverity;
  code: string;
  message: string;
  filename?: string;
  context?: StructuredContext;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    files: number;
    up: number;
    down: number;
  };
}

export interface ValidateMigrationsOptions {
  adapter?: MigrationAdapter;
  checkDatabase?: boolean;
}

interface MigrationFileInfo {
  filename: string;
  timestamp: string;
  baseName: string;
  direction: "up" | "down";
}

interface ValidationState {
  absolutePath: string;
  issues: ValidationIssue[];
  validFiles: MigrationFileInfo[];
  sqlByFilename: Map<string, string>;
}

const MIGRATION_FILENAME_REGEX = /^(\d+)(?:_.+)?\.(up|down)\.sql$/;
const TRANSACTION_STATEMENT_REGEX =
  /(?:^|;)\s*(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|ROLLBACK|START\s+TRANSACTION)\b\s*(?:;|$)/i;
const NON_TRANSACTIONAL_STATEMENT_REGEX =
  /(?:^|;)\s*(?:CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|DROP\s+INDEX\s+CONCURRENTLY|REINDEX\b[^;]*\bCONCURRENTLY|CREATE\s+DATABASE|DROP\s+DATABASE|ALTER\s+SYSTEM|VACUUM|CREATE\s+TABLESPACE|DROP\s+TABLESPACE)\b/i;

const stripSqlComments = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();

interface SqlScanAdvance {
  nextIndex: number;
  replacement: string;
}

const readDollarQuoteTag = (sql: string, position: number) => {
  const match = sql.slice(position).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0];
};

const advanceLineComment = (
  sql: string,
  index: number
): SqlScanAdvance | undefined => {
  if (!sql.startsWith("--", index)) {
    return undefined;
  }

  const newlineIndex = sql.indexOf("\n", index + 2);
  return newlineIndex === -1
    ? { nextIndex: sql.length, replacement: "" }
    : { nextIndex: newlineIndex + 1, replacement: "\n" };
};

const advanceBlockComment = (
  sql: string,
  index: number
): SqlScanAdvance | undefined => {
  if (!sql.startsWith("/*", index)) {
    return undefined;
  }

  const commentEnd = sql.indexOf("*/", index + 2);
  return {
    nextIndex: commentEnd === -1 ? sql.length : commentEnd + 2,
    replacement: " ",
  };
};

const findDelimitedTextEnd = (
  sql: string,
  index: number,
  delimiter: "'" | "\""
) => {
  let cursor = index + 1;
  const escapedDelimiter = `${delimiter}${delimiter}`;

  while (cursor !== sql.length) {
    if (sql.startsWith(escapedDelimiter, cursor)) {
      cursor += 2;
      continue;
    }

    if (sql.startsWith(delimiter, cursor)) {
      return cursor + 1;
    }

    cursor++;
  }

  return sql.length;
};

const advanceDelimitedText = (
  sql: string,
  index: number,
  delimiter: "'" | "\""
): SqlScanAdvance | undefined => {
  if (!sql.startsWith(delimiter, index)) {
    return undefined;
  }

  return {
    nextIndex: findDelimitedTextEnd(sql, index, delimiter),
    replacement: " ",
  };
};

const advanceDollarQuotedText = (
  sql: string,
  index: number
): SqlScanAdvance | undefined => {
  if (!sql.startsWith("$", index)) {
    return undefined;
  }

  const tag = readDollarQuoteTag(sql, index);
  if (!tag) {
    return undefined;
  }

  const tagEnd = sql.indexOf(tag, index + tag.length);
  if (tagEnd === -1) {
    return undefined;
  }

  return {
    nextIndex: tagEnd + tag.length,
    replacement: " ",
  };
};

const advanceIgnoredSqlSegment = (
  sql: string,
  index: number
): SqlScanAdvance | undefined =>
  advanceLineComment(sql, index) ??
  advanceBlockComment(sql, index) ??
  advanceDelimitedText(sql, index, "'") ??
  advanceDelimitedText(sql, index, "\"") ??
  advanceDollarQuotedText(sql, index);

const stripSqlCommentsAndQuotedText = (sql: string) => {
  let stripped = "";
  let index = 0;

  while (index < sql.length) {
    const ignoredSegment = advanceIgnoredSqlSegment(sql, index);
    if (ignoredSegment) {
      stripped += ignoredSegment.replacement;
      index = ignoredSegment.nextIndex;
      continue;
    }

    stripped += sql[index];
    index++;
  }

  return stripped.trim();
};

const parseMigrationFilename = (filename: string): MigrationFileInfo | undefined => {
  const match = filename.match(MIGRATION_FILENAME_REGEX);

  if (!match) {
    return undefined;
  }

  const timestamp = match[1];
  const direction = match[2];

  if (!timestamp || (direction !== "up" && direction !== "down")) {
    return undefined;
  }

  return {
    filename,
    timestamp,
    baseName: filename.replace(/\.(up|down)\.sql$/, ""),
    direction,
  };
};

const countBySeverity = (issues: ValidationIssue[], severity: ValidationSeverity) =>
  issues.filter((issue) => issue.severity === severity).length;

const createResult = (
  issues: ValidationIssue[],
  files: MigrationFileInfo[]
): ValidationResult => {
  const errors = countBySeverity(issues, "error");
  const warnings = countBySeverity(issues, "warning");

  return {
    ok: errors === 0,
    issues,
    summary: {
      errors,
      warnings,
      files: files.length,
      up: files.filter((file) => file.direction === "up").length,
      down: files.filter((file) => file.direction === "down").length,
    },
  };
};

const addIssue = (state: ValidationState, issue: ValidationIssue) => {
  state.issues.push(issue);
};

const createValidationState = (migrationsPath: string): ValidationState => ({
  absolutePath: resolve(migrationsPath),
  issues: [],
  validFiles: [],
  sqlByFilename: new Map(),
});

const readMigrationDirectory = async (state: ValidationState) => {
  try {
    await access(state.absolutePath);
    return await readdir(state.absolutePath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      addIssue(state, {
        severity: "error",
        code: "MIGRATIONS_DIRECTORY_UNREADABLE",
        message: `Migrations directory could not be read: ${state.absolutePath}`,
        context: {
          path: state.absolutePath,
          cause: error instanceof Error ? error.message : String(error),
        },
      });

      return undefined;
    }

    addIssue(state, {
      severity: "error",
      code: "MIGRATIONS_DIRECTORY_NOT_FOUND",
      message: `Migrations directory not found: ${state.absolutePath}`,
      context: {
        path: state.absolutePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    });

    return undefined;
  }
};

const getMigrationSqlIssues = (
  filename: string,
  sql: string
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const executableSql = stripSqlComments(sql);

  if (!executableSql) {
    issues.push({
      severity: "error",
      code: "EMPTY_MIGRATION_SQL",
      message: "Migration file does not contain executable SQL",
      filename,
    });
  }

  const executableStatements = stripSqlCommentsAndQuotedText(sql);

  if (TRANSACTION_STATEMENT_REGEX.test(executableStatements)) {
    issues.push({
      severity: "error",
      code: "TRANSACTION_STATEMENT_NOT_ALLOWED",
      message: "Migration files run inside Tusk-managed transactions and must not include transaction control statements",
      filename,
    });
  }

  if (NON_TRANSACTIONAL_STATEMENT_REGEX.test(executableStatements)) {
    issues.push({
      severity: "error",
      code: "NON_TRANSACTIONAL_STATEMENT_NOT_ALLOWED",
      message: "Migration files run inside Tusk-managed transactions and cannot contain PostgreSQL statements that require running outside a transaction",
      filename,
    });
  }

  return issues;
};

const validateMigrationFile = async (
  state: ValidationState,
  filename: string
) => {
  const parsed = parseMigrationFilename(filename);

  if (!parsed) {
    addIssue(state, {
      severity: "error",
      code: "INVALID_MIGRATION_FILENAME",
      message: "Migration filename must start with a numeric timestamp and end with .up.sql or .down.sql",
      filename,
    });
    return;
  }

  state.validFiles.push(parsed);

  try {
    const sql = await readFile(resolve(state.absolutePath, filename), "utf-8");
    state.sqlByFilename.set(filename, sql);
    for (const issue of getMigrationSqlIssues(filename, sql)) {
      addIssue(state, issue);
    }
  } catch (error) {
    addIssue(state, {
      severity: "error",
      code: "MIGRATION_FILE_UNREADABLE",
      message: "Migration file could not be read",
      filename,
      context: {
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

const groupMigrationFiles = (files: MigrationFileInfo[]) => {
  const directionsByBaseName = new Map<string, Set<"up" | "down">>();
  const baseNamesByTimestamp = new Map<string, Set<string>>();

  for (const file of files) {
    const directions = directionsByBaseName.get(file.baseName) ?? new Set();
    directions.add(file.direction);
    directionsByBaseName.set(file.baseName, directions);

    const baseNames = baseNamesByTimestamp.get(file.timestamp) ?? new Set();
    baseNames.add(file.baseName);
    baseNamesByTimestamp.set(file.timestamp, baseNames);
  }

  return { directionsByBaseName, baseNamesByTimestamp };
};

const validateMigrationPairs = (
  state: ValidationState,
  directionsByBaseName: Map<string, Set<"up" | "down">>
) => {
  for (const [baseName, directions] of directionsByBaseName.entries()) {
    if (!directions.has("up")) {
      addIssue(state, {
        severity: "error",
        code: "MISSING_UP_MIGRATION",
        message: "Migration pair is missing its .up.sql file",
        filename: `${baseName}.up.sql`,
      });
    }

    if (!directions.has("down")) {
      addIssue(state, {
        severity: "error",
        code: "MISSING_DOWN_MIGRATION",
        message: "Migration pair is missing its .down.sql file",
        filename: `${baseName}.down.sql`,
      });
    }
  }
};

const validateDuplicateTimestamps = (
  state: ValidationState,
  baseNamesByTimestamp: Map<string, Set<string>>
) => {
  for (const [timestamp, baseNames] of baseNamesByTimestamp.entries()) {
    if (baseNames.size > 1) {
      addIssue(state, {
        severity: "error",
        code: "DUPLICATE_MIGRATION_TIMESTAMP",
        message: "Multiple migration pairs use the same timestamp, which makes execution order ambiguous",
        context: {
          timestamp,
          migrations: [...baseNames],
        },
      });
    }
  }
};

const validateExecutedMigrationRecord = (
  state: ValidationState,
  record: Awaited<ReturnType<typeof getExecutedMigrationRecordsReadOnly>>[number]
) => {
  const sql = state.sqlByFilename.get(record.filename);

  if (!sql) {
    addIssue(state, {
      severity: "error",
      code: "EXECUTED_MIGRATION_FILE_MISSING",
      message: "Executed migration is missing from the migrations directory",
      filename: record.filename,
    });
    return;
  }

  if (!record.checksum) {
    addIssue(state, {
      severity: "warning",
      code: "EXECUTED_MIGRATION_CHECKSUM_MISSING",
      message: "Executed migration does not have a stored checksum",
      filename: record.filename,
    });
    return;
  }

  const currentChecksum = calculateChecksum(sql);
  if (currentChecksum !== record.checksum) {
    addIssue(state, {
      severity: "error",
      code: "EXECUTED_MIGRATION_CHECKSUM_MISMATCH",
      message: "Executed migration file has changed since it was applied",
      filename: record.filename,
      context: {
        expected: record.checksum,
        actual: currentChecksum,
      },
    });
  }
};

const validateDatabaseState = async (
  state: ValidationState,
  options: ValidateMigrationsOptions
) => {
  if (!options.checkDatabase) {
    return;
  }

  if (!options.adapter) {
    addIssue(state, {
      severity: "error",
      code: "DATABASE_CHECK_REQUIRES_ADAPTER",
      message: "Database validation requires a database adapter",
    });
    return;
  }

  try {
    const records = await getExecutedMigrationRecordsReadOnly(options.adapter);

    for (const record of records) {
      validateExecutedMigrationRecord(state, record);
    }
  } catch (error) {
    addIssue(state, {
      severity: "error",
      code: "DATABASE_VALIDATION_FAILED",
      message: "Database validation could not query migration state",
      context: {
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

export const validateMigrations = async (
  migrationsPath: string,
  options: ValidateMigrationsOptions = {}
): Promise<ValidationResult> => {
  const state = createValidationState(migrationsPath);
  const directoryEntries = await readMigrationDirectory(state);

  if (!directoryEntries) {
    return createResult(state.issues, state.validFiles);
  }

  const sqlFiles = directoryEntries.filter((file) => file.endsWith(".sql")).sort();
  for (const filename of sqlFiles) {
    await validateMigrationFile(state, filename);
  }

  const groups = groupMigrationFiles(state.validFiles);
  validateMigrationPairs(state, groups.directionsByBaseName);
  validateDuplicateTimestamps(state, groups.baseNamesByTimestamp);
  await validateDatabaseState(state, options);

  return createResult(state.issues, state.validFiles);
};

export const assertNoValidationErrors = (issues: ValidationIssue[]) => {
  if (issues.some((issue) => issue.severity === "error")) {
    throw createValidationError(
      "Migration validation failed. Fix the reported files before planning or executing migrations.",
      { issues }
    );
  }
};

export const assertMigrationDirectoryExecutable = async (
  migrationsPath: string
) => {
  const result = await validateMigrations(migrationsPath);
  if (result.issues.some(
    (issue) => issue.code === "MIGRATIONS_DIRECTORY_NOT_FOUND"
  )) {
    throw createMigrationDirectoryError(migrationsPath);
  }
  assertNoValidationErrors(result.issues);
  return result;
};

export const assertMigrationBatchExecutable = (migrations: Migration[]) => {
  const issues = migrations.flatMap((migration) =>
    getMigrationSqlIssues(migration.filename, migration.sql)
  );
  assertNoValidationErrors(issues);
};
