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
});
