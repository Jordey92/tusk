import type { ColumnInfo, TableInfo, IntrospectedSchema, ForeignKeyInfo } from "../types/schema";
import { logger } from "../utils/logger";

/**
 * Convert a column definition to SQL
 */
export const columnToSQL = (column: ColumnInfo): string => {
  let sql = column.name;

  // Map PostgreSQL types to SQL types
  let type = column.type.toUpperCase();

  // Handle SERIAL types (integer with nextval default)
  if (
    column.type === "integer" &&
    column.defaultValue &&
    column.defaultValue.includes("nextval")
  ) {
    type = "SERIAL";
  } else if (column.type === "character varying") {
    type = column.characterMaximumLength
      ? `VARCHAR(${column.characterMaximumLength})`
      : "VARCHAR";
  } else if (column.type === "timestamp with time zone") {
    type = "TIMESTAMPTZ";
  } else if (column.type === "timestamp without time zone") {
    type = "TIMESTAMP";
  }

  sql += ` ${type}`;

  // Add NOT NULL constraint
  if (!column.isNullable) {
    sql += " NOT NULL";
  }

  // Add DEFAULT clause (skip for SERIAL types)
  if (
    column.defaultValue &&
    !column.defaultValue.includes("nextval") &&
    type !== "SERIAL"
  ) {
    sql += ` DEFAULT ${column.defaultValue}`;
  }

  return sql;
};

/**
 * Generate CREATE TABLE statement for a table
 */
export const generateCreateTable = (table: TableInfo): string => {
  logger.debug("Generating CREATE TABLE statement", { tableName: table.name });

  const lines: string[] = [];

  // Add column definitions
  table.columns.forEach((column) => {
    lines.push(`  ${columnToSQL(column)}`);
  });

  // Add PRIMARY KEY constraint
  if (table.primaryKeys.length > 0) {
    const pkColumns = table.primaryKeys
      .sort((a, b) => a.position - b.position)
      .map((pk) => pk.columnName)
      .join(", ");
    lines.push(`  PRIMARY KEY (${pkColumns})`);
  }

  // Add UNIQUE constraints
  table.uniqueConstraints.forEach((unique) => {
    lines.push(`  UNIQUE (${unique.columnNames.join(", ")})`);
  });

  // Add FOREIGN KEY constraints
  table.foreignKeys.forEach((fk) => {
    let fkLine = `  FOREIGN KEY (${fk.columnName}) REFERENCES ${fk.foreignTableName}(${fk.foreignColumnName})`;

    if (fk.updateRule && fk.updateRule !== "NO ACTION") {
      fkLine += ` ON UPDATE ${fk.updateRule}`;
    }

    if (fk.deleteRule && fk.deleteRule !== "NO ACTION") {
      fkLine += ` ON DELETE ${fk.deleteRule}`;
    }

    lines.push(fkLine);
  });

  const sql = `CREATE TABLE ${table.name} (\n${lines.join(",\n")}\n);`;

  logger.debug("Generated CREATE TABLE statement", { tableName: table.name });

  return sql;
};

/**
 * Generate DROP TABLE statement
 */
export const generateDropTable = (tableName: string): string => {
  return `DROP TABLE IF EXISTS ${tableName} CASCADE;`;
};

/**
 * Topologically sort tables by their foreign key dependencies
 */
export const sortTablesByDependencies = (tables: TableInfo[]): TableInfo[] => {
  logger.debug("Sorting tables by dependencies", { tableCount: tables.length });

  const tableMap = new Map(tables.map((t) => [t.name, t]));
  const sorted: TableInfo[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (tableName: string) => {
    if (visited.has(tableName)) return;

    if (visiting.has(tableName)) {
      logger.warn("Circular dependency detected", { tableName });
      return;
    }

    visiting.add(tableName);

    const table = tableMap.get(tableName);
    if (table) {
      // Visit all tables this table depends on first
      table.foreignKeys.forEach((fk: ForeignKeyInfo) => {
        if (fk.foreignTableName !== tableName) {
          visit(fk.foreignTableName);
        }
      });

      visited.add(tableName);
      visiting.delete(tableName);
      sorted.push(table);
    }
  };

  tables.forEach((table) => visit(table.name));

  logger.debug("Tables sorted by dependencies", { sortedOrder: sorted.map((t) => t.name) });

  return sorted;
};

/**
 * Generate the UP migration SQL
 */
export const generateUpMigration = (schema: IntrospectedSchema): string => {
  logger.info("Generating UP migration", { tableCount: schema.tables.length });

  const sorted = sortTablesByDependencies(schema.tables);
  const statements: string[] = [];

  // Add CREATE TABLE statements
  sorted.forEach((table) => {
    statements.push(generateCreateTable(table));
  });

  // Add CREATE INDEX statements
  sorted.forEach((table) => {
    table.indexes.forEach((index) => {
      // Use the full index definition from pg_indexes
      statements.push(`${index.indexDefinition};`);
    });
  });

  const sql = statements.join("\n\n");

  logger.info("Generated UP migration", { statementCount: statements.length });

  return sql;
};

/**
 * Generate the DOWN migration SQL
 */
export const generateDownMigration = (schema: IntrospectedSchema): string => {
  logger.info("Generating DOWN migration", { tableCount: schema.tables.length });

  const sorted = sortTablesByDependencies(schema.tables);
  const statements: string[] = [];

  // Drop tables in reverse dependency order
  sorted.reverse().forEach((table) => {
    statements.push(generateDropTable(table.name));
  });

  const sql = statements.join("\n");

  logger.info("Generated DOWN migration", { statementCount: statements.length });

  return sql;
};
