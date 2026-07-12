import type {
  ConnectionPool,
  DatabaseAdapter,
  DatabaseAdapterOptions,
} from "../types/migrations.js";
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

export const createPgAdapter = (
  pool: ConnectionPool,
  options: DatabaseAdapterOptions = {}
): DatabaseAdapter => {
  const lockingMethods = createLockingMethods(pool);
  const getActiveClient = lockingMethods.getActiveLockClient;
  const executeQuery = createExecuteQuery(pool, getActiveClient);
  const transaction = createTransaction(pool, getActiveClient, options);
  const introspectionMethods = createIntrospectionMethods(executeQuery);

  return {
    query: executeQuery,
    transaction,
    acquireMigrationLock: lockingMethods.acquireMigrationLock,
    releaseMigrationLock: lockingMethods.releaseMigrationLock,
    ...introspectionMethods,
    columnToSQL,
    generateCreateTable,
    generateDropTable,
    sortTablesByDependencies,
    generateUpMigration,
    generateDownMigration,
  };
};
