import { describe, expect, test } from "bun:test";
import { createIntrospectionMethods } from "./introspection";

describe("createIntrospectionMethods", () => {
  test("preserves identity column metadata", async () => {
    const introspection = createIntrospectionMethods(async (sql) => {
      if (sql.includes("FROM information_schema.columns")) {
        return {
          rows: [
            {
              column_name: "id",
              data_type: "integer",
              is_nullable: "NO",
              column_default: null,
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              udt_name: "int4",
              is_identity: "YES",
              identity_generation: "BY DEFAULT",
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const columns = await introspection.getTableColumns("widgets");

    expect(columns).toHaveLength(1);
    expect(columns[0].isIdentity).toBe(true);
    expect(columns[0].identityGeneration).toBe("BY DEFAULT");
  });

  test("pairs composite foreign-key columns by ordinal position", async () => {
    let query = "";
    const introspection = createIntrospectionMethods(async (sql) => {
      query = sql;
      return {
        rows: [
          {
            column_name: "account_id",
            foreign_table_schema: "public",
            foreign_table_name: "accounts",
            foreign_column_name: "tenant_id",
            update_rule: "NO ACTION",
            delete_rule: "CASCADE",
            constraint_name: "orders_account_fkey",
          },
          {
            column_name: "account_number",
            foreign_table_schema: "public",
            foreign_table_name: "accounts",
            foreign_column_name: "number",
            update_rule: "NO ACTION",
            delete_rule: "CASCADE",
            constraint_name: "orders_account_fkey",
          },
        ],
      };
    });

    const foreignKeys = await introspection.getForeignKeys("orders");
    expect(foreignKeys.map((foreignKey) => foreignKey.foreignColumnName)).toEqual([
      "tenant_id",
      "number",
    ]);
    expect(query).toContain(
      "referenced_kcu.ordinal_position = kcu.position_in_unique_constraint"
    );
  });
});
