import { describe, expect, it } from "vitest";

import { getOzonAnalyticsSummary } from "./analytics";
import type { OzonClient } from "./client";

describe("Ozon analytics data completeness", () => {
  it("marks stock and visibility unknown instead of reporting zero", async () => {
    const client = {
      listProducts: async () => ({ items: [{ product_id: 1, offer_id: "offer-1" }], total: 1 }),
      getProductInfoList: async () => {
        throw new Error("details unavailable");
      },
      getProductStocks: async () => {
        throw new Error("stocks unavailable");
      },
      listFbsPostings: async () => [],
      listFboPostings: async () => [],
    } as unknown as OzonClient;

    const summary = await getOzonAnalyticsSummary({
      client,
      since: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-09-02T00:00:00Z"),
    });

    expect(summary.totalStock).toBeNull();
    expect(summary.lowStockCount).toBeNull();
    expect(summary.visibleProductCount).toBeNull();
    expect(summary.products[0]).toMatchObject({ stock: null, reservedStock: null, visible: null });
    expect(summary.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("商品详情同步失败"),
      expect.stringContaining("库存同步失败"),
    ]));
  });
});
