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
  column_default: string | null;
  identity_generation: string | null;
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

export type MigrationTableState =
  | {
      state: "missing";
    }
  | {
      state: "ready";
      checksumColumn: "present";
    }
  | {
      state: "legacy_missing_checksum_column";
      checksumColumn: "missing";
    }
  | {
      state: "invalid_shape";
      checksumColumn: "present" | "missing";
      issues: MigrationTableShapeIssue[];
    };

type TrustedMigrationTableState = Exclude<
  MigrationTableState,
  { state: "invalid_shape" }
>;

interface ExpectedMigrationTableColumn {
  name: string;
  type: string;
  nullability: "not_null" | "nullable";
  presence?: "required" | "legacy_optional";
  generatedValue?: "required";
  defaultExpression?: string;
}

const expectedColumns: ExpectedMigrationTableColumn[] = [
  {
    name: "id",
    type: "integer",
    nullability: "not_null",
    generatedValue: "required",
  },
  {
    name: "filename",
    type: "character varying(255)",
    nullability: "not_null",
  },
  {
    name: "executed_at",
    type: "timestamp without time zone",
    nullability: "nullable",
    defaultExpression: "now()",
  },
  {
    name: "checksum",
    type: "character varying(64)",
    nullability: "nullable",
    presence: "legacy_optional",
  },
];

const readMigrationTablePresence = async (
  adapter: DatabaseAdapter
): Promise<"present" | "missing"> => {
  const result = await adapter.query<MigrationTableExistsRow>(
    `SELECT to_regclass('${MIGRATION_METADATA_TABLE_NAME}')::text AS migration_table`
  );

  return result.rows[0]?.migration_table === MIGRATION_METADATA_TABLE_NAME
    ? "present"
    : "missing";
};

const getMigrationTableColumns = async (
  adapter: DatabaseAdapter
): Promise<MigrationTableColumnRow[]> => {
  const result = await adapter.query<MigrationTableColumnRow>(`
    SELECT
      a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS formatted_type,
      a.attnotnull AS is_not_null,
      CASE
        WHEN d.adbin IS NULL THEN NULL
        ELSE pg_get_expr(d.adbin, d.adrelid)
      END AS column_default,
      NULLIF(a.attidentity, '') AS identity_generation
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d
      ON d.adrelid = a.attrelid
      AND d.adnum = a.attnum
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

const formatNullability = (nullability: "not_null" | "nullable") =>
  nullability === "not_null" ? "NOT NULL" : "nullable";

const validateColumn = (
  expected: ExpectedMigrationTableColumn,
  actual: MigrationTableColumnRow | undefined
): MigrationTableShapeIssue[] => {
  if (!actual) {
    return expected.presence === "legacy_optional"
      ? []
      : [createMissingColumnIssue(expected)];
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

  const actualNullability = actual.is_not_null ? "not_null" : "nullable";

  if (actualNullability !== expected.nullability) {
    issues.push({
      code: "invalid_column_nullability",
      column: expected.name,
      expected: formatNullability(expected.nullability),
      actual: formatNullability(actualNullability),
      message: `_migrations.${expected.name} nullability is ${formatNullability(actualNullability)}; expected ${formatNullability(expected.nullability)}`,
    });
  }

  if (expected.generatedValue === "required") {
    const generatedValueState = actual.identity_generation !== null ||
      (actual.column_default?.startsWith("nextval(") ?? false)
      ? "present"
      : "missing";

    if (generatedValueState === "missing") {
      issues.push({
        code: "missing_generated_value",
        column: expected.name,
        expected: "SERIAL or identity-generated value",
        actual: actual.identity_generation
          ? `identity ${actual.identity_generation}`
          : actual.column_default ?? "none",
        message: `_migrations.${expected.name} must be auto-generated`,
      });
    }
  }

  if (
    expected.defaultExpression &&
    actual.column_default !== expected.defaultExpression
  ) {
    issues.push({
      code: "invalid_column_default",
      column: expected.name,
      expected: `DEFAULT ${expected.defaultExpression}`,
      actual: actual.column_default ?? "none",
      message: `_migrations.${expected.name} must default to ${expected.defaultExpression}`,
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
  const checksumColumn = columnsByName.has("checksum") ? "present" : "missing";
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

  if (issues.length > 0) {
    return {
      state: "invalid_shape",
      checksumColumn,
      issues,
    };
  }

  if (checksumColumn === "missing") {
    return {
      state: "legacy_missing_checksum_column",
      checksumColumn: "missing",
    };
  }

  return {
    state: "ready",
    checksumColumn: "present",
  };
};

export const getMigrationTableStateReadOnly = async (
  adapter: DatabaseAdapter
): Promise<MigrationTableState> => {
  const tablePresence = await readMigrationTablePresence(adapter);
  if (tablePresence === "missing") {
    return { state: "missing" };
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
): Promise<TrustedMigrationTableState> => {
  const tableState = await getMigrationTableStateReadOnly(adapter);

  if (tableState.state === "invalid_shape") {
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

export const getExecutedMigrationRecordsReadOnly = async (
  adapter: DatabaseAdapter
): Promise<MigrationRecord[]> => {
  const tableState = await assertMigrationTableShape(adapter);
  if (tableState.state === "missing") {
    return [];
  }

  const checksumSelection = tableState.state === "ready"
    ? "checksum"
    : "NULL::text AS checksum";
  const result = await adapter.query<MigrationRecordRow>(`
    SELECT filename, ${checksumSelection}, executed_at
    FROM ${MIGRATION_METADATA_TABLE_NAME}
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
  if (tableState.state === "missing") {
    return [];
  }

  const limit = count ?? Number.MAX_SAFE_INTEGER;
  const result = await adapter.query<MigrationFilenameRow>(
    `SELECT filename FROM ${MIGRATION_METADATA_TABLE_NAME} ORDER BY id DESC LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => row.filename);
};

export const getExecutedMigrationCountReadOnly = async (
  adapter: DatabaseAdapter
): Promise<number> => {
  const tableState = await assertMigrationTableShape(adapter);
  if (tableState.state === "missing") {
    return 0;
  }

  const result = await adapter.query<MigrationCountRow>(
    `SELECT COUNT(*)::integer AS count FROM ${MIGRATION_METADATA_TABLE_NAME}`
  );

  return Number(result.rows[0]?.count ?? 0);
};
