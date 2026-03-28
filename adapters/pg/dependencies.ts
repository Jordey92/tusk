import type { TableInfo, ForeignKeyInfo } from "../../types/schema.js";
import { logger } from "../../utils/logger.js";

const tableKey = (tableName: string, schema?: string) =>
  schema ? `${schema}.${tableName}` : tableName;

export const sortTablesByDependencies = (tables: TableInfo[]): TableInfo[] => {
  logger.debug("Sorting tables by dependencies", {
    tableCount: tables.length,
  });

  const tableMap = new Map(
    tables.map((table) => [tableKey(table.name, table.schema), table])
  );
  const sorted: TableInfo[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (key: string) => {
    if (visited.has(key)) return;

    if (visiting.has(key)) {
      logger.warn("Circular dependency detected", { tableName: key });
      return;
    }

    visiting.add(key);

    const table = tableMap.get(key);
    if (table) {
      // Visit all tables this table depends on first
      table.foreignKeys.forEach((fk: ForeignKeyInfo) => {
        const dependencyKey = tableKey(
          fk.foreignTableName,
          fk.foreignSchema ?? table.schema
        );

        if (dependencyKey !== key) {
          visit(dependencyKey);
        }
      });

      visited.add(key);
      visiting.delete(key);
      sorted.push(table);
    }
  };

  tables.forEach((table) => visit(tableKey(table.name, table.schema)));

  logger.debug("Tables sorted by dependencies", {
    sortedOrder: sorted.map((table) => tableKey(table.name, table.schema)),
  });

  return sorted;
};
