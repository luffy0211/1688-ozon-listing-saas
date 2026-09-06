import { describe, expect, it } from "vitest";
import {
  buildStoreDiagnosis,
  cachedCompetitorReport,
  lowContentRatingProducts,
  selectCompetitorTargets,
  summarizeFinanceTransactions,
} from "./operations";

const summary = (overrides: Record<string, unknown> = {}) => ({
  productCount: 10,
  visibleProductCount: 8,
  archivedProductCount: 1,
  totalStock: 80,
  lowStockCount: 2,
  fbsOrderCount: 7,
  fboOrderCount: 3,
  pendingShipmentCount: 1,
  cancelledOrderCount: 1,
  grossRevenueRub: 10_000,
  dailyOrders: [
    { date: "2026-09-01", fbs: 2, fbo: 1 },
    { date: "2026-09-02", fbs: 1, fbo: 0 },
  ],
  topProducts: [],
  products: [],
  warnings: [],
  ...overrides,
});

describe("Ozon operations helpers", () => {
  it("does not reuse incomplete competitor reports", () => {
    expect(cachedCompetitorReport({ source: "ozon_public_category", competitors: [] })).toBeNull();
    expect(cachedCompetitorReport({ source: "ozon_public_category", competitors: [{}] })).toBeNull();
    expect(cachedCompetitorReport({
      source: "ozon_public_category",
      category: { url: "https://www.ozon.ru/category/example-1/" },
      competitors: [{ sku: "1" }],
    })).toBeTruthy();
  });

  it("summarizes Ozon net payout and platform charges", () => {
    expect(
      summarizeFinanceTransactions([
        {
          amount: 700,
          accruals_for_sale: 1_000,
          sale_commission: -150,
          delivery_charge: -50,
          return_delivery_charge: 0,
          services: [{ price: -100 }],
        },
      ]),
    ).toEqual({
      transactionCount: 1,
      salesAccrualRub: 1_000,
      ozonNetPayoutRub: 700,
      salesCommissionRub: 150,
      deliveryFeesRub: 50,
      serviceFeesRub: 100,
      platformFeesRub: 300,
    });
  });

  it("builds period comparisons without calling net payout profit", () => {
    const diagnosis = buildStoreDiagnosis({
      current: summary(),
      previous: summary({ fbsOrderCount: 4, fboOrderCount: 1, grossRevenueRub: 8_000 }),
      finance: {
        transactionCount: 1,
        salesAccrualRub: 10_000,
        ozonNetPayoutRub: 7_000,
        salesCommissionRub: 1_500,
        deliveryFeesRub: 500,
        serviceFeesRub: 1_000,
        platformFeesRub: 3_000,
      },
      capturedAt: "2026-09-06T00:00:00.000Z",
    });

    expect(diagnosis.current30d.orderCount).toBe(10);
    expect(diagnosis.comparison.orderCountChangeRate).toBe(1);
    expect(diagnosis.finance.ozonNetPayoutRub).toBe(7_000);
    expect(diagnosis).not.toHaveProperty("profit");
  });

  it("selects top sellers first and falls back to visible stocked products", () => {
    expect(
      selectCompetitorTargets(
        summary({
          topProducts: [{ offerId: "best", name: "Best", quantity: 8, revenueRub: 900 }],
          products: [
            { offerId: "best", name: "Best", publicSku: "9001", visible: true, archived: false, stock: 2 },
            { offerId: "fallback", name: "Fallback", publicSku: "9002", visible: true, archived: false, stock: 9 },
          ],
        }) as never,
      ),
    ).toEqual([{ offerId: "best", title: "Best", publicSku: "9001", quantity: 8, revenueRub: 900 }]);

    expect(
      selectCompetitorTargets(
        summary({
          products: [
            { offerId: "hidden", name: "Hidden", publicSku: "9003", visible: false, archived: false, stock: 20 },
            { offerId: "stocked", name: "Stocked", publicSku: "9004", visible: true, archived: false, stock: 9 },
          ],
        }) as never,
      ),
    ).toEqual([{ offerId: "stocked", title: "Stocked", publicSku: "9004", quantity: 0, revenueRub: 0 }]);
  });

  it("sorts low content-rating products and keeps Ozon improvement evidence", () => {
    expect(
      lowContentRatingProducts(
        [
          { productId: "1", offerId: "good", name: "Good", publicSku: "100", imageUrl: null },
          { productId: "2", offerId: "low", name: "Low", publicSku: "200", imageUrl: "low.jpg" },
        ] as never,
        [
          { sku: 100, rating: 85, groups: [] },
          {
            sku: 200,
            rating: 35,
            groups: [
              {
                key: "media",
                name: "Media",
                rating: 5,
                weight: 30,
                improve_at_least: 1,
                conditions: [{ key: "images", description: "Add images", fulfilled: false, cost: 10 }],
                improve_attributes: [{ id: 77, name: "Season" }],
              },
            ],
          },
        ],
        70,
      ),
    ).toEqual([
      expect.objectContaining({
        offerId: "low",
        publicSku: "200",
        contentRating: 35,
        recommendations: ["Add images", "补充属性：Season"],
      }),
    ]);
  });
});
