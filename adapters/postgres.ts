import { Pool, QueryResultRow } from "pg";
import type {
  DatabaseAdapter,
  TransactionClient,
  QueryParam,
} from "../types/migrations";
import type {
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
  UniqueConstraintInfo,
  IndexInfo,
  TableInfo,
  IntrospectedSchema,
} from "../types/schema";
import { logger } from "../utils/logger";

// Row type interfaces for database queries
interface TableNameRow extends QueryResultRow {
  table_name: string;
}

interface ColumnRow extends QueryResultRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  udt_name: string;
}

interface PrimaryKeyRow extends QueryResultRow {
  column_name: string;
  ordinal_position: number;
}

interface ForeignKeyRow extends QueryResultRow {
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
  update_rule: string;
  delete_rule: string;
  constraint_name: string;
}

interface UniqueConstraintRow extends QueryResultRow {
  constraint_name: string;
  column_names: string[] | string;
}

interface IndexRow extends QueryResultRow {
  indexname: string;
  indexdef: string;
}

interface LockRow extends QueryResultRow {
  acquired: boolean;
}

// Migration lock ID for PostgreSQL advisory locks
const MIGRATION_LOCK_ID = 123456789;

// Transaction timeout in milliseconds (5 minutes)
const TRANSACTION_TIMEOUT_MS = 300000;

export const createPostgresAdapter = (pool: Pool): DatabaseAdapter => {
  // Helper function to execute queries
  const executeQuery = async <T extends QueryResultRow = QueryResultRow>(sql: string, params?: QueryParam[]) => {
    try {
      logger.debug("Executing query", { sql: sql.substring(0, 100), paramCount: params?.length });
      return await pool.query<T>(sql, params);
    } catch (error) {
      logger.error("Query execution failed", {
        sql: sql.substring(0, 100),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };

  return {
    // Core database operations
    query: executeQuery,

    transaction: async (callback) => {
      const client = await pool.connect();
      let transactionStarted = false;

      try {
        logger.debug("Starting database transaction");
        await client.query("BEGIN");
        transactionStarted = true;

        // Set statement timeout to prevent hanging migrations
        await client.query(`SET LOCAL statement_timeout = '${TRANSACTION_TIMEOUT_MS}'`);
        logger.debug(`Transaction timeout set to ${TRANSACTION_TIMEOUT_MS}ms`);

        const transactionClient: TransactionClient = {
          query: async <T extends QueryResultRow = QueryResultRow>(sql: string, params?: QueryParam[]) => {
            try {
              logger.debug("Executing transaction query", { sql: sql.substring(0, 100) });
              return await client.query<T>(sql, params);
            } catch (error) {
              logger.error("Transaction query failed", {
                sql: sql.substring(0, 100),
                error: error instanceof Error ? error.message : String(error)
              });
              throw error;
            }
          },
        };

        const result = await callback(transactionClient);

        logger.debug("Committing transaction");
        await client.query("COMMIT");
        logger.debug("Transaction committed successfully");
        return result;

      } catch (error) {
        if (transactionStarted) {
          try {
            logger.debug("Rolling back transaction due to error");
            await client.query("ROLLBACK");
            logger.debug("Transaction rolled back successfully");
          } catch (rollbackError) {
            logger.error("Failed to rollback transaction", {
              originalError: error instanceof Error ? error.message : String(error),
              rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            });
          }
        }

        logger.error("Transaction failed", {
          error: error instanceof Error ? error.message : String(error),
          transactionStarted
        });
        throw error;

      } finally {
        try {
          client.release();
          logger.debug("Database client released");
        } catch (releaseError) {
          logger.warn("Failed to release database client", {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError)
          });
        }
      }
    },

    // Migration safety
    acquireMigrationLock: async () => {
      logger.debug("Attempting to acquire migration lock");

      const result = await executeQuery<LockRow>(
        "SELECT pg_try_advisory_lock($1) as acquired",
        [MIGRATION_LOCK_ID]
      );

      const lockResult = result.rows[0];
      if (!lockResult || !lockResult.acquired) {
        logger.warn("Migration lock acquisition failed - another process is running migrations");
        throw new Error(
          "Another migration process is currently running. " +
          "Please wait for it to complete before running migrations again."
        );
      }

      logger.info("Migration lock acquired successfully");
    },

    releaseMigrationLock: async () => {
      logger.debug("Releasing migration lock");

      await executeQuery(
        "SELECT pg_advisory_unlock($1)",
        [MIGRATION_LOCK_ID]
      );

      logger.debug("Migration lock released successfully");
    },

    // Introspection methods
    getTableNames: async (schema: string = "public"): Promise<string[]> => {
      logger.debug("Getting table names", { schema });

      const result = await executeQuery<TableNameRow>(
        `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
          AND table_name != '_migrations'
        ORDER BY table_name
        `,
        [schema]
      );

      const tableNames = result.rows.map((row) => row.table_name);
      logger.debug("Found tables", { count: tableNames.length, tables: tableNames });

      return tableNames;
    },

    getTableColumns: async (tableName: string): Promise<ColumnInfo[]> => {
      logger.debug("Getting columns for table", { tableName });

      const result = await executeQuery<ColumnRow>(
        `
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale,
          udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        ORDER BY ordinal_position
        `,
        [tableName]
      );

      const columns: ColumnInfo[] = result.rows.map((row) => ({
        name: row.column_name,
        type: row.data_type,
        isNullable: row.is_nullable === "YES",
        defaultValue: row.column_default,
        characterMaximumLength: row.character_maximum_length,
        numericPrecision: row.numeric_precision,
        numericScale: row.numeric_scale,
        udtName: row.udt_name,
      }));

      logger.debug("Found columns", { tableName, count: columns.length });

      return columns;
    },

    getPrimaryKeys: async (tableName: string): Promise<PrimaryKeyInfo[]> => {
      logger.debug("Getting primary keys for table", { tableName });

      const result = await executeQuery<PrimaryKeyRow>(
        `
        SELECT kcu.column_name, kcu.ordinal_position
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = $1
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
        `,
        [tableName]
      );

      const primaryKeys: PrimaryKeyInfo[] = result.rows.map((row) => ({
        columnName: row.column_name,
        position: row.ordinal_position,
      }));

      logger.debug("Found primary keys", { tableName, count: primaryKeys.length });

      return primaryKeys;
    },

    getForeignKeys: async (tableName: string): Promise<ForeignKeyInfo[]> => {
      logger.debug("Getting foreign keys for table", { tableName });

      const result = await executeQuery<ForeignKeyRow>(
        `
        SELECT
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.update_rule,
          rc.delete_rule,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = $1
          AND tc.constraint_type = 'FOREIGN KEY'
        `,
        [tableName]
      );

      const foreignKeys: ForeignKeyInfo[] = result.rows.map((row) => ({
        columnName: row.column_name,
        foreignTableName: row.foreign_table_name,
        foreignColumnName: row.foreign_column_name,
        updateRule: row.update_rule,
        deleteRule: row.delete_rule,
        constraintName: row.constraint_name,
      }));

      logger.debug("Found foreign keys", { tableName, count: foreignKeys.length });

      return foreignKeys;
    },

    getUniqueConstraints: async (tableName: string): Promise<UniqueConstraintInfo[]> => {
      logger.debug("Getting unique constraints for table", { tableName });

      const result = await executeQuery<UniqueConstraintRow>(
        `
        SELECT
          tc.constraint_name,
          array_agg(kcu.column_name ORDER BY kcu.ordinal_position) as column_names
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = $1
          AND tc.constraint_type = 'UNIQUE'
        GROUP BY tc.constraint_name
        `,
        [tableName]
      );

      const uniqueConstraints: UniqueConstraintInfo[] = result.rows.map((row) => {
        // PostgreSQL array_agg might return a PostgreSQL array or JavaScript array
        // depending on the driver configuration
        const columnNames = Array.isArray(row.column_names)
          ? row.column_names
          : (row.column_names as string).replace(/[{}]/g, "").split(",");

        return {
          constraintName: row.constraint_name,
          columnNames,
        };
      });

      logger.debug("Found unique constraints", { tableName, count: uniqueConstraints.length });

      return uniqueConstraints;
    },

    getIndexes: async (tableName: string): Promise<IndexInfo[]> => {
      logger.debug("Getting indexes for table", { tableName });

      const result = await executeQuery<IndexRow>(
        `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = $1
          AND indexname NOT LIKE '%_pkey'
        `,
        [tableName]
      );

      const indexes: IndexInfo[] = result.rows.map((row) => ({
        indexName: row.indexname,
        indexDefinition: row.indexdef,
      }));

      logger.debug("Found indexes", { tableName, count: indexes.length });

      return indexes;
    },

    introspectTable: async function (tableName: string): Promise<TableInfo> {
      logger.info("Introspecting table", { tableName });

      const [columns, primaryKeys, foreignKeys, uniqueConstraints, indexes] = await Promise.all([
        this.getTableColumns(tableName),
        this.getPrimaryKeys(tableName),
        this.getForeignKeys(tableName),
        this.getUniqueConstraints(tableName),
        this.getIndexes(tableName),
      ]);

      const tableInfo: TableInfo = {
        name: tableName,
        columns,
        primaryKeys,
        foreignKeys,
        uniqueConstraints,
        indexes,
      };

      logger.info("Table introspection complete", { tableName });

      return tableInfo;
    },

    introspectDatabase: async function (schema: string = "public"): Promise<IntrospectedSchema> {
      logger.info("Starting database introspection", { schema });

      const tableNames = await this.getTableNames(schema);

      const tables = await Promise.all(
        tableNames.map((tableName) => this.introspectTable(tableName))
      );

      logger.info("Database introspection complete", { tableCount: tables.length });

      return { tables };
    },

    // DDL generation methods
    columnToSQL: (column: ColumnInfo): string => {
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
    },

    generateCreateTable: function (table: TableInfo): string {
      logger.debug("Generating CREATE TABLE statement", { tableName: table.name });

      const lines: string[] = [];

      // Add column definitions
      table.columns.forEach((column) => {
        lines.push(`  ${this.columnToSQL(column)}`);
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
    },

    generateDropTable: (tableName: string): string => {
      return `DROP TABLE IF EXISTS ${tableName} CASCADE;`;
    },

    sortTablesByDependencies: (tables: TableInfo[]): TableInfo[] => {
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
    },

    generateUpMigration: function (schema: IntrospectedSchema): string {
      logger.info("Generating UP migration", { tableCount: schema.tables.length });

      const sorted = this.sortTablesByDependencies(schema.tables);
      const statements: string[] = [];

      // Add CREATE TABLE statements
      sorted.forEach((table) => {
        statements.push(this.generateCreateTable(table));
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
    },

    generateDownMigration: function (schema: IntrospectedSchema): string {
      logger.info("Generating DOWN migration", { tableCount: schema.tables.length });

      const sorted = this.sortTablesByDependencies(schema.tables);
      const statements: string[] = [];

      // Drop tables in reverse dependency order
      sorted.reverse().forEach((table) => {
        statements.push(this.generateDropTable(table.name));
      });

      const sql = statements.join("\n");

      logger.info("Generated DOWN migration", { statementCount: statements.length });

      return sql;
    },
  };
};
