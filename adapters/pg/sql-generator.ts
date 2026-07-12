import type { ColumnInfo, TableInfo, IntrospectedSchema } from "../../types/schema.js";
import { logger } from "../../utils/logger.js";
import { sortTablesByDependencies } from "./dependencies.js";

const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, "\"\"")}"`;

const qualifyTableName = (tableName: string, schema?: string): string => {
  if (!schema) {
    return quoteIdentifier(tableName);
  }

  return `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
};

const quoteColumnList = (columns: string[]): string =>
  columns.map((column) => quoteIdentifier(column)).join(", ");

export const columnToSQL = (column: ColumnInfo): string => {
  let sql = quoteIdentifier(column.name);
  let type = column.type.toUpperCase();

  // Handle SERIAL types (integer with nextval default)
  if (
    !column.isIdentity &&
    column.type === "integer" &&
    column.defaultValue &&
    column.defaultValue.includes("nextval")
  ) {
    type = "SERIAL";
  } else if (column.type === "character varying") {
    type = column.characterMaximumLength
      ? `VARCHAR(${column.characterMaximumLength})`
      : "VARCHAR";
  } else if (column.type === "numeric") {
    // Preserve NUMERIC precision and scale
    if (column.numericPrecision !== null) {
      if (column.numericScale !== null && column.numericScale > 0) {
        type = `NUMERIC(${column.numericPrecision}, ${column.numericScale})`;
      } else {
        type = `NUMERIC(${column.numericPrecision})`;
      }
    } else {
      type = "NUMERIC";
    }
  } else if (column.type === "timestamp with time zone") {
    type = "TIMESTAMPTZ";
  } else if (column.type === "timestamp without time zone") {
    type = "TIMESTAMP";
  }

  sql += ` ${type}`;

  if (column.isIdentity) {
    const generation = column.identityGeneration ?? "BY DEFAULT";
    sql += ` GENERATED ${generation} AS IDENTITY`;
  }

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
    // Uppercase boolean values and SQL functions for consistency
    let defaultValue = column.defaultValue;

    // Handle common patterns
    if (
      defaultValue.toLowerCase() === "false" ||
      defaultValue.toLowerCase() === "true"
    ) {
      defaultValue = defaultValue.toUpperCase();
    } else if (defaultValue.toLowerCase().includes("now()")) {
      defaultValue = defaultValue.replace(/now\(\)/gi, "NOW()");
    } else if (defaultValue.toLowerCase().includes("gen_random_uuid()")) {
      defaultValue = defaultValue.replace(
        /gen_random_uuid\(\)/gi,
        "gen_random_uuid()"
      );
    }

    sql += ` DEFAULT ${defaultValue}`;
  }

  return sql;
};

export const generateCreateTable = (
  table: TableInfo,
  includeForeignKeys: boolean = true
): string => {
  logger.debug("Generating CREATE TABLE statement", {
    tableName: table.name,
  });

  const lines: string[] = [];

  table.columns.forEach((column) => {
    lines.push(`  ${columnToSQL(column)}`);
  });

  if (table.primaryKeys.length > 0) {
    const pkColumns = table.primaryKeys
      .sort((a, b) => a.position - b.position)
      .map((pk) => pk.columnName);
    lines.push(`  PRIMARY KEY (${quoteColumnList(pkColumns)})`);
  }

  table.uniqueConstraints.forEach((unique) => {
    lines.push(`  UNIQUE (${quoteColumnList(unique.columnNames)})`);
  });

  if (includeForeignKeys) table.foreignKeys.forEach((fk) => {
    let fkLine =
      `  FOREIGN KEY (${quoteIdentifier(fk.columnName)}) REFERENCES ` +
      `${qualifyTableName(
        fk.foreignTableName,
        fk.foreignSchema ?? table.schema
      )}(${quoteIdentifier(fk.foreignColumnName)})`;

    if (fk.updateRule && fk.updateRule !== "NO ACTION") {
      fkLine += ` ON UPDATE ${fk.updateRule}`;
    }

    if (fk.deleteRule && fk.deleteRule !== "NO ACTION") {
      fkLine += ` ON DELETE ${fk.deleteRule}`;
    }

    lines.push(fkLine);
  });

  const sql = `CREATE TABLE ${qualifyTableName(table.name, table.schema)} (\n${lines.join(",\n")}\n);`;

  logger.debug("Generated CREATE TABLE statement", {
    tableName: table.name,
  });

  return sql;
};

const generateForeignKeyStatements = (table: TableInfo): string[] => {
  const byConstraint = new Map<string, typeof table.foreignKeys>();
  for (const foreignKey of table.foreignKeys) {
    const existing = byConstraint.get(foreignKey.constraintName) ?? [];
    existing.push(foreignKey);
    byConstraint.set(foreignKey.constraintName, existing);
  }

  return [...byConstraint.entries()].map(([constraintName, foreignKeys]) => {
    const first = foreignKeys[0]!;
    const columns = foreignKeys.map((foreignKey) => foreignKey.columnName);
    const foreignColumns = foreignKeys.map(
      (foreignKey) => foreignKey.foreignColumnName
    );
    let statement =
      `ALTER TABLE ${qualifyTableName(table.name, table.schema)} ` +
      `ADD CONSTRAINT ${quoteIdentifier(constraintName)} ` +
      `FOREIGN KEY (${quoteColumnList(columns)}) REFERENCES ` +
      `${qualifyTableName(
        first.foreignTableName,
        first.foreignSchema ?? table.schema
      )}(${quoteColumnList(foreignColumns)})`;

    if (first.updateRule && first.updateRule !== "NO ACTION") {
      statement += ` ON UPDATE ${first.updateRule}`;
    }
    if (first.deleteRule && first.deleteRule !== "NO ACTION") {
      statement += ` ON DELETE ${first.deleteRule}`;
    }

    return `${statement};`;
  });
};

export const generateDropTable = (tableName: string, schema?: string): string => {
  return `DROP TABLE IF EXISTS ${qualifyTableName(tableName, schema)} CASCADE;`;
};

export const generateUpMigration = (schema: IntrospectedSchema): string => {
  logger.info("Generating UP migration", {
    tableCount: schema.tables.length,
  });

  const sorted = sortTablesByDependencies(schema.tables);
  const statements: string[] = [];

  const schemas = new Set(
    sorted
      .map((table) => table.schema)
      .filter((schemaName): schemaName is string =>
        Boolean(schemaName && schemaName !== "public")
      )
  );
  for (const schemaName of schemas) {
    statements.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)};`);
  }

  sorted.forEach((table) => {
    statements.push(generateCreateTable(table, false));
  });

  sorted.forEach((table) => {
    statements.push(...generateForeignKeyStatements(table));
  });

  sorted.forEach((table) => {
    // Filter out indexes that duplicate UNIQUE constraints
    const uniqueColumnSets = new Set(
      table.uniqueConstraints.map((uc) => uc.columnNames.sort().join(","))
    );

    // Also track primary key columns (they're implicitly unique)
    const pkColumns = table.primaryKeys
      .sort((a, b) => a.position - b.position)
      .map((pk) => pk.columnName)
      .sort()
      .join(",");
    if (pkColumns) {
      uniqueColumnSets.add(pkColumns);
    }

    table.indexes.forEach((index) => {
      // Extract column names from index definition to check for duplicates
      // Parse: CREATE [UNIQUE] INDEX name ON table (col1, col2, ...)
      const indexDefMatch = index.indexDefinition.match(/\(([^)]+)\)/);
      if (indexDefMatch && indexDefMatch[1]) {
        const indexColumns = indexDefMatch[1]
          .split(",")
          .map((col) => col.trim().replace(/"/g, ""))
          .sort()
          .join(",");

        // Skip if this index duplicates a UNIQUE constraint or PRIMARY KEY
        if (
          uniqueColumnSets.has(indexColumns) &&
          index.indexDefinition.includes("UNIQUE")
        ) {
          logger.debug("Skipping duplicate unique index", {
            indexName: index.indexName,
            columns: indexColumns,
          });
          return;
        }
      }

      // Clean up index definition - remove schema prefix for cleaner output
      let cleanedDef = index.indexDefinition
        .replace(/ON\s+public\./i, "ON ")
        .replace(/\s+USING\s+btree/gi, "");

      statements.push(`${cleanedDef};`);
    });
  });

  const sql = statements.join("\n\n");

  logger.info("Generated UP migration", {
    statementCount: statements.length,
  });

  return sql;
};

export const generateDownMigration = (schema: IntrospectedSchema): string => {
  logger.info("Generating DOWN migration", {
    tableCount: schema.tables.length,
  });

  const sorted = sortTablesByDependencies(schema.tables);
  const statements: string[] = [];

  sorted.reverse().forEach((table) => {
    statements.push(generateDropTable(table.name, table.schema));
  });

  const sql = statements.join("\n");

  logger.info("Generated DOWN migration", {
    statementCount: statements.length,
  });

  return sql;
};
