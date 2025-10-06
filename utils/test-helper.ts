import { Pool } from "pg";

export const createTestPool = () => {
  return new Pool({
    user: "user",
    host: "localhost",
    database: "migrate_tool_test",
    password: "password",
    port: 5433,
  });
};

export const cleanupMigrations = async (pool: Pool) => {
  await pool.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
  `);
};
