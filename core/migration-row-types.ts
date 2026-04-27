import type { QueryResultRow } from "../types/migrations.js";

export interface MigrationFilenameRow extends QueryResultRow {
  filename: string;
}

export interface MigrationRecordRow extends QueryResultRow {
  filename: string;
  checksum: string | null;
  executed_at: Date;
}
