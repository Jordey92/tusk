import { Pool } from "pg";
import type { DatabaseAdapter } from "../types/migrations.js";
import { createExecuteQuery, createTransaction } from "./postgres/query.js";
import { createLockingMethods } from "./postgres/locking.js";
import { createIntrospectionMethods } from "./postgres/introspection.js";
import {
  columnToSQL,
  generateCreateTable,
  generateDropTable,
  generateUpMigration,
  generateDownMigration,
} from "./postgres/sql-generator.js";
import { sortTablesByDependencies } from "./postgres/dependencies.js";

export const createPostgresAdapter = (pool: Pool): DatabaseAdapter => {
  const executeQuery = createExecuteQuery(pool);
  const transaction = createTransaction(pool);
  const lockingMethods = createLockingMethods(executeQuery);
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
