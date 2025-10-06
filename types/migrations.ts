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
  query(sql: string, params?: any[]): Promise<QueryResult>;
  transaction<T>(
    callback: (client: TransactionClient) => Promise<T>
  ): Promise<T>;
}

export type RunResult = {
  executed: number;
  pending: number;
};
