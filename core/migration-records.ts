import type {
  DatabaseAdapter,
  MigrationRecord,
  QueryResultRow,
} from "../types/migrations.js";
import { createMetadataTableError } from "../utils/errors.js";
import type {
  MigrationFilenameRow,
  MigrationRecordRow,
} from "./migration-row-types.js";

export const MIGRATION_METADATA_TABLE_NAME = "_migrations";

interface MigrationTableExistsRow extends QueryResultRow {
  migration_table: string | null;
}

interface MigrationTableColumnRow extends QueryResultRow {
  column_name: string;
  formatted_type: string;
  is_not_null: boolean;
}

interface MigrationTableConstraintRow extends QueryResultRow {
  constraint_type: "p" | "u";
  columns: string[];
}

interface MigrationCountRow extends QueryResultRow {
  count: number;
}

export interface MigrationTableShapeIssue {
  code: string;
  message: string;
  column?: string;
  expected?: string;
  actual?: string;
}

export interface MigrationTableState {
  exists: boolean;
  hasChecksum: boolean;
  valid: boolean;
  issues: MigrationTableShapeIssue[];
  legacyChecksumColumnMissing: boolean;
}

interface ExpectedMigrationTableColumn {
  name: string;
  type: string;
  notNull: boolean;
  legacyOptional?: boolean;
}

const expectedColumns: ExpectedMigrationTableColumn[] = [
  { name: "id", type: "integer", notNull: true },
  { name: "filename", type: "character varying(255)", notNull: true },
  { name: "executed_at", type: "timestamp without time zone", notNull: false },
  {
    name: "checksum",
    type: "character varying(64)",
    notNull: false,
    legacyOptional: true,
  },
];

const migrationTableExists = async (adapter: DatabaseAdapter): Promise<boolean> => {
  const result = await adapter.query<MigrationTableExistsRow>(
    `SELECT to_regclass('${MIGRATION_METADATA_TABLE_NAME}')::text AS migration_table`
  );

  return result.rows[0]?.migration_table === MIGRATION_METADATA_TABLE_NAME;
};

const getMigrationTableColumns = async (
  adapter: DatabaseAdapter
): Promise<MigrationTableColumnRow[]> => {
  const result = await adapter.query<MigrationTableColumnRow>(`
    SELECT
      a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS formatted_type,
      a.attnotnull AS is_not_null
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('${MIGRATION_METADATA_TABLE_NAME}')
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `);

  return result.rows;
};

const getMigrationTableConstraints = async (
  adapter: DatabaseAdapter
): Promise<MigrationTableConstraintRow[]> => {
  const result = await adapter.query<MigrationTableConstraintRow>(`
    SELECT
      c.contype AS constraint_type,
      ARRAY_AGG(a.attname ORDER BY columns.ordinality)::text[] AS columns
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS columns(attnum, ordinality)
      ON true
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
      AND a.attnum = columns.attnum
    WHERE c.conrelid = to_regclass('${MIGRATION_METADATA_TABLE_NAME}')
      AND c.contype IN ('p', 'u')
    GROUP BY c.oid, c.contype
  `);

  return result.rows;
};

const createMissingColumnIssue = (
  column: ExpectedMigrationTableColumn
): MigrationTableShapeIssue => ({
  code: "missing_column",
  column: column.name,
  expected: column.type,
  message: `_migrations is missing required column ${column.name}`,
});

const validateColumn = (
  expected: ExpectedMigrationTableColumn,
  actual: MigrationTableColumnRow | undefined
): MigrationTableShapeIssue[] => {
  if (!actual) {
    return expected.legacyOptional ? [] : [createMissingColumnIssue(expected)];
  }

  const issues: MigrationTableShapeIssue[] = [];
  if (actual.formatted_type !== expected.type) {
    issues.push({
      code: "invalid_column_type",
      column: expected.name,
      expected: expected.type,
      actual: actual.formatted_type,
      message: `_migrations.${expected.name} has type ${actual.formatted_type}; expected ${expected.type}`,
    });
  }

  if (actual.is_not_null !== expected.notNull) {
    issues.push({
      code: "invalid_column_nullability",
      column: expected.name,
      expected: expected.notNull ? "NOT NULL" : "nullable",
      actual: actual.is_not_null ? "NOT NULL" : "nullable",
      message: `_migrations.${expected.name} nullability is ${actual.is_not_null ? "NOT NULL" : "nullable"}; expected ${expected.notNull ? "NOT NULL" : "nullable"}`,
    });
  }

  return issues;
};

const columnsEqual = (actual: string[], expected: string[]) =>
  actual.length === expected.length &&
  actual.every((column, index) => column === expected[index]);

const hasConstraint = (
  constraints: MigrationTableConstraintRow[],
  type: MigrationTableConstraintRow["constraint_type"],
  columns: string[]
) =>
  constraints.some((constraint) =>
    constraint.constraint_type === type && columnsEqual(constraint.columns, columns)
  );

const validateMigrationTableShape = (
  columns: MigrationTableColumnRow[],
  constraints: MigrationTableConstraintRow[]
): MigrationTableState => {
  const columnsByName = new Map(
    columns.map((column) => [column.column_name, column])
  );
  const expectedColumnNames = new Set(expectedColumns.map((column) => column.name));
  const hasChecksum = columnsByName.has("checksum");
  const issues = expectedColumns.flatMap((column) =>
    validateColumn(column, columnsByName.get(column.name))
  );

  for (const column of columns) {
    if (!expectedColumnNames.has(column.column_name)) {
      issues.push({
        code: "unexpected_column",
        column: column.column_name,
        actual: column.formatted_type,
        message: `_migrations has unexpected column ${column.column_name}`,
      });
    }
  }

  if (!hasConstraint(constraints, "p", ["id"])) {
    issues.push({
      code: "missing_primary_key",
      column: "id",
      expected: "PRIMARY KEY",
      message: "_migrations.id must be the primary key",
    });
  }

  if (!hasConstraint(constraints, "u", ["filename"])) {
    issues.push({
      code: "missing_unique_constraint",
      column: "filename",
      expected: "UNIQUE",
      message: "_migrations.filename must have a unique constraint",
    });
  }

  return {
    exists: true,
    hasChecksum,
    valid: issues.length === 0,
    issues,
    legacyChecksumColumnMissing: !hasChecksum,
  };
};

export const getMigrationTableStateReadOnly = async (
  adapter: DatabaseAdapter
): Promise<MigrationTableState> => {
  const exists = await migrationTableExists(adapter);
  if (!exists) {
    return {
      exists: false,
      hasChecksum: false,
      valid: true,
      issues: [],
      legacyChecksumColumnMissing: false,
    };
  }

  const columns = await getMigrationTableColumns(adapter);
  const constraints = await getMigrationTableConstraints(adapter);
  return validateMigrationTableShape(columns, constraints);
};

export const formatMigrationTableShapeIssues = (
  issues: MigrationTableShapeIssue[]
) => issues.map((issue) => issue.message).join("; ");

const toIssueContext = (issue: MigrationTableShapeIssue) => ({
  code: issue.code,
  message: issue.message,
  column: issue.column,
  expected: issue.expected,
  actual: issue.actual,
});

export const assertMigrationTableShape = async (
  adapter: DatabaseAdapter
): Promise<MigrationTableState> => {
  const tableState = await getMigrationTableStateReadOnly(adapter);

  if (tableState.exists && !tableState.valid) {
    throw createMetadataTableError(
      `_migrations table has an invalid shape: ${formatMigrationTableShapeIssues(tableState.issues)}`,
      {
        table: MIGRATION_METADATA_TABLE_NAME,
        issues: tableState.issues.map(toIssueContext),
      }
    );
  }

  return tableState;
};

const getTrustedMigrationTableState = async (adapter: DatabaseAdapter) => {
  const tableState = await assertMigrationTableShape(adapter);
  return {
    exists: tableState.exists,
    hasChecksum: tableState.hasChecksum,
  };
};

export const getExecutedMigrationRecordsReadOnly = async (
  adapter: DatabaseAdapter
): Promise<MigrationRecord[]> => {
  const tableState = await getTrustedMigrationTableState(adapter);
  if (!tableState.exists) {
    return [];
  }

  const checksumSelection = tableState.hasChecksum ? "checksum" : "NULL::text AS checksum";
  const result = await adapter.query<MigrationRecordRow>(`
    SELECT filename, ${checksumSelection}, executed_at
    FROM _migrations
    ORDER BY id ASC
  `);

  return result.rows.map((row) => ({
    filename: row.filename,
    checksum: row.checksum,
    executed_at: row.executed_at,
  }));
};

export const getLastExecutedMigrationFilenamesReadOnly = async (
  adapter: DatabaseAdapter,
  count?: number
): Promise<string[]> => {
  const tableState = await assertMigrationTableShape(adapter);
  if (!tableState.exists) {
    return [];
  }

  const limit = count ?? Number.MAX_SAFE_INTEGER;
  const result = await adapter.query<MigrationFilenameRow>(
    `SELECT filename FROM _migrations ORDER BY id DESC LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => row.filename);
};

export const getExecutedMigrationCountReadOnly = async (
  adapter: DatabaseAdapter
): Promise<number> => {
  const tableState = await assertMigrationTableShape(adapter);
  if (!tableState.exists) {
    return 0;
  }

  const result = await adapter.query<MigrationCountRow>(
    `SELECT COUNT(*)::integer AS count FROM _migrations`
  );

  return Number(result.rows[0]?.count ?? 0);
};
