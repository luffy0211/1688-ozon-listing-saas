import { describe, expect, it } from "vitest";
import {
  buildStoreDiagnosis,
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
          products: [{ offerId: "fallback", name: "Fallback", visible: true, archived: false, stock: 9 }],
        }) as never,
      ),
    ).toEqual([{ offerId: "best", title: "Best", quantity: 8, revenueRub: 900 }]);

    expect(
      selectCompetitorTargets(
        summary({
          products: [
            { offerId: "hidden", name: "Hidden", visible: false, archived: false, stock: 20 },
            { offerId: "stocked", name: "Stocked", visible: true, archived: false, stock: 9 },
          ],
        }) as never,
      ),
    ).toEqual([{ offerId: "stocked", title: "Stocked", quantity: 0, revenueRub: 0 }]);
  });
});
