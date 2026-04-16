import type { DatabaseAdapter } from "../types/migrations.js";
import type { ConnectionPool } from "../types/migrations.js";
import { createExecuteQuery, createTransaction } from "./pg/query.js";
import { createLockingMethods } from "./pg/locking.js";
import { createIntrospectionMethods } from "./pg/introspection.js";
import {
  columnToSQL,
  generateCreateTable,
  generateDropTable,
  generateUpMigration,
  generateDownMigration,
} from "./pg/sql-generator.js";
import { sortTablesByDependencies } from "./pg/dependencies.js";

export const createPgAdapter = (pool: ConnectionPool): DatabaseAdapter => {
  const executeQuery = createExecuteQuery(pool);
  const transaction = createTransaction(pool);
  const lockingMethods = createLockingMethods(pool);
  const introspectionMethods = createIntrospectionMethods(executeQuery);

  return {
    query: executeQuery,
    transaction,
    ...lockingMethods,
    ...introspectionMethods,
    columnToSQL,
    generateCreateTable,
    generateDropTable,
    sortTablesByDependencies,
    generateUpMigration,
    generateDownMigration,
  };
};
