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
  name: string;
  sql: string;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}
export interface TransactionClient {
  query(sql: string, params?: any[]): Promise<QueryResult>;
}

export interface DatabaseAdapter {
  // Core database operations
  query(sql: string, params?: any[]): Promise<QueryResult>;
  transaction<T>(
    callback: (client: TransactionClient) => Promise<T>
  ): Promise<T>;

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
