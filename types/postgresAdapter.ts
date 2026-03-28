import type { QueryResultRow } from "pg";

export interface TableNameRow extends QueryResultRow {
  table_name: string;
}

export interface ColumnRow extends QueryResultRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  udt_name: string;
  is_identity: string;
  identity_generation: string | null;
}

export interface PrimaryKeyRow extends QueryResultRow {
  column_name: string;
  ordinal_position: number;
}

export interface ForeignKeyRow extends QueryResultRow {
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
  update_rule: string;
  delete_rule: string;
  constraint_name: string;
}

export interface UniqueConstraintRow extends QueryResultRow {
  constraint_name: string;
  column_names: string[] | string;
}

export interface IndexRow extends QueryResultRow {
  indexname: string;
  indexdef: string;
}

export interface LockRow extends QueryResultRow {
  acquired: boolean;
}
