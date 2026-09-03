import { describe, expect, it } from "vitest";
import { getOzonAnalyticsSummary } from "./analytics";
import type { OzonClient } from "./client";

describe("getOzonAnalyticsSummary", () => {
  it("builds top products from recent postings", async () => {
    const client = {
      listProducts: async () => ({
        items: [{ product_id: 1, offer_id: "offer-1" }],
        total: 1,
      }),
      getProductInfoList: async () => [
        {
          product_id: 1,
          offer_id: "offer-1",
          name: "Dress",
          visible: true,
          price: "1000",
        },
      ],
      getProductStocks: async () => [
        {
          product_id: 1,
          offer_id: "offer-1",
          stocks: [{ present: 8, reserved: 1 }],
        },
      ],
      listFbsPostings: async () => [
        {
          posting_number: "fbs-1",
          in_process_at: "2026-09-02T00:00:00.000Z",
          products: [{ offer_id: "offer-1", name: "Dress", quantity: 2, price: "1000" }],
          financial_data: { products: [{ payout: "1800", quantity: 2 }] },
        },
      ],
      listFboPostings: async () => [
        {
          posting_number: "fbo-1",
          in_process_at: "2026-09-02T00:00:00.000Z",
          products: [{ offer_id: "offer-1", name: "Dress", quantity: 1, price: "1000" }],
          financial_data: { products: [{ payout: "900", quantity: 1 }] },
        },
      ],
    } as unknown as OzonClient;

    const summary = await getOzonAnalyticsSummary({
      client,
      since: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-03T00:00:00.000Z"),
    });

    expect(summary.grossRevenueRub).toBe(2700);
    expect(summary.topProducts).toEqual([
      { offerId: "offer-1", name: "Dress", quantity: 3, revenueRub: 2700 },
    ]);
  });
});
