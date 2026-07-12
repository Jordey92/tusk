import type {
  TableInfo,
  IntrospectedSchema,
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
  UniqueConstraintInfo,
  IndexInfo,
} from "./schema.js";

export type QueryResultRow = Record<string, unknown>;

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

export interface QueryResult<T = QueryResultRow> {
  rows: T[];
  rowCount: number | null;
}

export interface QueryClient {
  /** Execute PostgreSQL SQL with `$1`-style positional parameters. */
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

export interface DatabaseAdapterOptions {
  /**
   * PostgreSQL statement timeout applied inside each migration transaction.
   * Use 0 to keep the database/session default.
   */
  statementTimeoutMs?: number;
}

/**
 * Minimal adapter contract required to plan and execute migrations.
 *
 * Implement this interface for custom database clients that only need Tusk's
 * migration runner. Baseline generation additionally requires DatabaseAdapter.
 */
export interface MigrationAdapter extends QueryClient {
  /**
   * Run the callback atomically on one connection, committing its result or
   * rolling back every query when it rejects.
   */
  transaction<T>(
    callback: (client: TransactionClient) => Promise<T>
  ): Promise<T>;

  // Migration safety
  /**
   * Acquire an exclusive, session-scoped migration lock and retain the owning
   * connection until releaseMigrationLock. Reject when the adapter is already
   * running a migration operation or another runner owns the lock.
   */
  acquireMigrationLock(): Promise<void>;
  /** Release the acquired lock and its owning connection; be safe to call once. */
  releaseMigrationLock(): Promise<void>;
}

/** Full adapter contract, including existing-database baseline generation. */
export interface DatabaseAdapter extends MigrationAdapter {
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
