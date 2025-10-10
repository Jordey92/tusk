import type { DatabaseAdapter } from "../types/migrations";
import type {
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
  UniqueConstraintInfo,
  IndexInfo,
  TableInfo,
  IntrospectedSchema,
} from "../types/schema";
import { logger } from "../utils/logger";

export const getTableNames = async (
  adapter: DatabaseAdapter,
  schema: string = "public"
): Promise<string[]> => {
  logger.debug("Getting table names", { schema });

  const result = await adapter.query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_type = 'BASE TABLE'
      AND table_name != '_migrations'
    ORDER BY table_name
    `,
    [schema]
  );

  const tableNames = result.rows.map((row) => row.table_name);
  logger.debug("Found tables", { count: tableNames.length, tables: tableNames });

  return tableNames;
};

export const getTableColumns = async (
  adapter: DatabaseAdapter,
  tableName: string
): Promise<ColumnInfo[]> => {
  logger.debug("Getting columns for table", { tableName });

  const result = await adapter.query(
    `
    SELECT
      column_name,
      data_type,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName]
  );

  const columns: ColumnInfo[] = result.rows.map((row) => ({
    name: row.column_name,
    type: row.data_type,
    isNullable: row.is_nullable === "YES",
    defaultValue: row.column_default,
    characterMaximumLength: row.character_maximum_length,
    numericPrecision: row.numeric_precision,
    numericScale: row.numeric_scale,
    udtName: row.udt_name,
  }));

  logger.debug("Found columns", { tableName, count: columns.length });

  return columns;
};

export const getPrimaryKeys = async (
  adapter: DatabaseAdapter,
  tableName: string
): Promise<PrimaryKeyInfo[]> => {
  logger.debug("Getting primary keys for table", { tableName });

  const result = await adapter.query(
    `
    SELECT kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = $1
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
    `,
    [tableName]
  );

  const primaryKeys: PrimaryKeyInfo[] = result.rows.map((row) => ({
    columnName: row.column_name,
    position: row.ordinal_position,
  }));

  logger.debug("Found primary keys", { tableName, count: primaryKeys.length });

  return primaryKeys;
};

export const getForeignKeys = async (
  adapter: DatabaseAdapter,
  tableName: string
): Promise<ForeignKeyInfo[]> => {
  logger.debug("Getting foreign keys for table", { tableName });

  const result = await adapter.query(
    `
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = $1
      AND tc.constraint_type = 'FOREIGN KEY'
    `,
    [tableName]
  );

  const foreignKeys: ForeignKeyInfo[] = result.rows.map((row) => ({
    columnName: row.column_name,
    foreignTableName: row.foreign_table_name,
    foreignColumnName: row.foreign_column_name,
    updateRule: row.update_rule,
    deleteRule: row.delete_rule,
    constraintName: row.constraint_name,
  }));

  logger.debug("Found foreign keys", { tableName, count: foreignKeys.length });

  return foreignKeys;
};

export const getUniqueConstraints = async (
  adapter: DatabaseAdapter,
  tableName: string
): Promise<UniqueConstraintInfo[]> => {
  logger.debug("Getting unique constraints for table", { tableName });

  const result = await adapter.query(
    `
    SELECT
      tc.constraint_name,
      array_agg(kcu.column_name ORDER BY kcu.ordinal_position) as column_names
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = $1
      AND tc.constraint_type = 'UNIQUE'
    GROUP BY tc.constraint_name
    `,
    [tableName]
  );

  const uniqueConstraints: UniqueConstraintInfo[] = result.rows.map((row) => {
    // PostgreSQL array_agg might return a PostgreSQL array or JavaScript array
    // depending on the driver configuration
    const columnNames = Array.isArray(row.column_names)
      ? row.column_names
      : row.column_names.replace(/[{}]/g, "").split(",");

    return {
      constraintName: row.constraint_name,
      columnNames,
    };
  });

  logger.debug("Found unique constraints", { tableName, count: uniqueConstraints.length });

  return uniqueConstraints;
};

export const getIndexes = async (
  adapter: DatabaseAdapter,
  tableName: string
): Promise<IndexInfo[]> => {
  logger.debug("Getting indexes for table", { tableName });

  const result = await adapter.query(
    `
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = $1
      AND indexname NOT LIKE '%_pkey'
    `,
    [tableName]
  );

  const indexes: IndexInfo[] = result.rows.map((row) => ({
    indexName: row.indexname,
    indexDefinition: row.indexdef,
  }));

  logger.debug("Found indexes", { tableName, count: indexes.length });

  return indexes;
};

export const introspectTable = async (
  adapter: DatabaseAdapter,
  tableName: string
): Promise<TableInfo> => {
  logger.info("Introspecting table", { tableName });

  const [columns, primaryKeys, foreignKeys, uniqueConstraints, indexes] = await Promise.all([
    getTableColumns(adapter, tableName),
    getPrimaryKeys(adapter, tableName),
    getForeignKeys(adapter, tableName),
    getUniqueConstraints(adapter, tableName),
    getIndexes(adapter, tableName),
  ]);

  const tableInfo: TableInfo = {
    name: tableName,
    columns,
    primaryKeys,
    foreignKeys,
    uniqueConstraints,
    indexes,
  };

  logger.info("Table introspection complete", { tableName });

  return tableInfo;
};

export const introspectDatabase = async (
  adapter: DatabaseAdapter,
  schema: string = "public"
): Promise<IntrospectedSchema> => {
  logger.info("Starting database introspection", { schema });

  const tableNames = await getTableNames(adapter, schema);

  const tables = await Promise.all(
    tableNames.map((tableName) => introspectTable(adapter, tableName))
  );

  logger.info("Database introspection complete", { tableCount: tables.length });

  return { tables };
};
