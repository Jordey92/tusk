import type { QueryResultRow } from "pg";
import type {
  TableInfo,
  IntrospectedSchema,
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
  UniqueConstraintInfo,
  IndexInfo,
} from "./schema.js";

export interface Migration {
  filename: string;
  timestamp: string;
  sql: string;
}

export interface MigrationRecord {
  filename: string;
  checksum: string | null;
  executed_at: Date;
}

export interface ConnectionConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

export type QueryParam = string | number | boolean | Date | null;
export type { QueryResultRow };

export interface QueryResult<T = QueryResultRow> {
  rows: T[];
  rowCount: number | null;
}

export interface QueryClient {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: QueryParam[]
  ): Promise<QueryResult<T>>;
}

export interface ConnectionClient extends QueryClient {
  release(): void;
}

export interface ConnectionPool extends QueryClient {
  connect(): Promise<ConnectionClient>;
}

export interface TransactionClient extends QueryClient {
}

export interface DatabaseAdapter extends QueryClient {
  transaction<T>(
    callback: (client: TransactionClient) => Promise<T>
  ): Promise<T>;

  // Migration safety
  acquireMigrationLock(): Promise<void>;
  releaseMigrationLock(): Promise<void>;

  // Introspection capabilities
  introspectDatabase(schema?: string): Promise<IntrospectedSchema>;
  introspectTable(tableName: string, schema?: string): Promise<TableInfo>;
  getTableNames(schema?: string): Promise<string[]>;
  getTableColumns(tableName: string, schema?: string): Promise<ColumnInfo[]>;
  getPrimaryKeys(tableName: string, schema?: string): Promise<PrimaryKeyInfo[]>;
  getForeignKeys(tableName: string, schema?: string): Promise<ForeignKeyInfo[]>;
  getUniqueConstraints(
    tableName: string,
    schema?: string
  ): Promise<UniqueConstraintInfo[]>;
  getIndexes(tableName: string, schema?: string): Promise<IndexInfo[]>;

  // DDL generation capabilities
  generateCreateTable(table: TableInfo): string;
  generateDropTable(tableName: string, schema?: string): string;
  generateUpMigration(schema: IntrospectedSchema): string;
  generateDownMigration(schema: IntrospectedSchema): string;
  columnToSQL(column: ColumnInfo): string;
  sortTablesByDependencies(tables: TableInfo[]): TableInfo[];
}

export type RollbackTargetPayload =
  | {
      mode: "count";
      requestedCount: number;
      availableRollbackCount: number;
    }
  | {
      mode: "all";
      availableRollbackCount: number;
    };

export type MigrationRunResult = {
  executed: number;
  pending: number;
};

export type UpRunResult = MigrationRunResult & {
  rollbackTarget?: never;
};

export type DownRunResult = MigrationRunResult & {
  rollbackTarget: RollbackTargetPayload;
};

export type RunResult = UpRunResult | DownRunResult;
