import type { QueryResultRow } from "pg";
import type {
  TableInfo,
  IntrospectedSchema,
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
  UniqueConstraintInfo,
  IndexInfo,
} from "./schema";

export interface Migration {
  filename: string;
  timestamp: string;
  sql: string;
}

// Valid PostgreSQL query parameter types
export type QueryParam = string | number | boolean | Date | null;

export interface QueryResult<T = QueryResultRow> {
  rows: T[];
  rowCount: number | null;
}

export interface TransactionClient {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>;
}

export interface DatabaseAdapter {
  // Core database operations
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>;
  transaction<T>(
    callback: (client: TransactionClient) => Promise<T>
  ): Promise<T>;

  // Migration safety
  acquireMigrationLock(): Promise<void>;
  releaseMigrationLock(): Promise<void>;

  // Introspection capabilities
  introspectDatabase(schema?: string): Promise<IntrospectedSchema>;
  introspectTable(tableName: string): Promise<TableInfo>;
  getTableNames(schema?: string): Promise<string[]>;
  getTableColumns(tableName: string): Promise<ColumnInfo[]>;
  getPrimaryKeys(tableName: string): Promise<PrimaryKeyInfo[]>;
  getForeignKeys(tableName: string): Promise<ForeignKeyInfo[]>;
  getUniqueConstraints(tableName: string): Promise<UniqueConstraintInfo[]>;
  getIndexes(tableName: string): Promise<IndexInfo[]>;

  // DDL generation capabilities
  generateCreateTable(table: TableInfo): string;
  generateDropTable(tableName: string): string;
  generateUpMigration(schema: IntrospectedSchema): string;
  generateDownMigration(schema: IntrospectedSchema): string;
  columnToSQL(column: ColumnInfo): string;
  sortTablesByDependencies(tables: TableInfo[]): TableInfo[];
}

export type RunResult = {
  executed: number;
  pending: number;
};
