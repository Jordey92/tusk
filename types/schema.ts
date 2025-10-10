export interface ColumnInfo {
  name: string;
  type: string;
  isNullable: boolean;
  defaultValue: string | null;
  characterMaximumLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  udtName: string; // For custom types and enums
}

export interface PrimaryKeyInfo {
  columnName: string;
  position: number;
}

export interface ForeignKeyInfo {
  columnName: string;
  foreignTableName: string;
  foreignColumnName: string;
  updateRule: string;
  deleteRule: string;
  constraintName: string;
}

export interface UniqueConstraintInfo {
  constraintName: string;
  columnNames: string[];
}

export interface IndexInfo {
  indexName: string;
  indexDefinition: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  primaryKeys: PrimaryKeyInfo[];
  foreignKeys: ForeignKeyInfo[];
  uniqueConstraints: UniqueConstraintInfo[];
  indexes: IndexInfo[];
}

export interface IntrospectedSchema {
  tables: TableInfo[];
}
