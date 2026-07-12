import { describe, expect, test } from "bun:test";
import type { DatabaseAdapter, QueryResultRow } from "../types/migrations";
import { assertBaselineCompatible } from "./baseline-compatibility";

const adapterWithRows = (rows: QueryResultRow[]) => ({
  query: async () => ({ rows, rowCount: rows.length }),
}) as DatabaseAdapter;

describe("baseline compatibility", () => {
  test("accepts schemas whose supported feature scan is empty", async () => {
    await expect(
      assertBaselineCompatible(adapterWithRows([]), "public")
    ).resolves.toBeUndefined();
  });

  test("fails closed with actionable unsupported feature details", async () => {
    const adapter = adapterWithRows([
      {
        feature: "column_type",
        object_name: "orders.state",
        detail: "data_type=USER-DEFINED udt=order_state",
      },
      {
        feature: "check_constraint",
        object_name: "orders.orders_total_check",
        detail: "CHECK (total >= 0)",
      },
    ]);

    try {
      await assertBaselineCompatible(adapter, "public");
      throw new Error("Expected baseline compatibility to fail");
    } catch (error) {
      expect(error).toHaveProperty("code", "BASELINE_UNSUPPORTED");
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("cannot reproduce safely")
      );
      expect(error).toHaveProperty("context.issues", [
        expect.objectContaining({
          feature: "column_type",
          objectName: "orders.state",
        }),
        expect.objectContaining({
          feature: "check_constraint",
          objectName: "orders.orders_total_check",
        }),
      ]);
    }
  });
});
