import type { TableInfo, ForeignKeyInfo } from "../../types/schema.js";
import { logger } from "../../utils/logger.js";

export const sortTablesByDependencies = (tables: TableInfo[]): TableInfo[] => {
  logger.debug("Sorting tables by dependencies", {
    tableCount: tables.length,
  });

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

  logger.debug("Tables sorted by dependencies", {
    sortedOrder: sorted.map((t) => t.name),
  });

  return sorted;
};
