import { describe, expect, it } from "vitest";
import { selectPromotionCandidates } from "./promotions";

describe("promotion candidate selection", () => {
  it("uses server candidate values and the active policy", () => {
    const result = selectPromotionCandidates({
      candidates: [
        { id: 10, price: 1_000, action_price: 850, max_action_price: 900, stock: 12 },
        { id: 11, price: 1_000, action_price: 950, max_action_price: 950, stock: 2 },
      ],
      policy: {
        all: [
          { field: "stock", operator: "gte", value: 5 },
          { field: "discountRate", operator: "gte", value: 0.1 },
        ],
      },
      priceRule: { mode: "multiplier", value: 0.85 },
      salesByProductId: new Map([["10", { orders30d: 8, revenue30d: 6_800 }]]),
    });

    expect(result.eligible).toEqual([
      expect.objectContaining({ productId: 10, actionPrice: 850, stock: 12 }),
    ]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ productId: 11, reason: "condition_failed:stock:gte" }),
    ]);
  });

  it("blocks a candidate when the policy needs unavailable evidence", () => {
    const result = selectPromotionCandidates({
      candidates: [{ id: 10, price: 1_000, action_price: 850, max_action_price: 900, stock: 12 }],
      policy: { all: [{ field: "contentRating", operator: "gte", value: 4 }] },
      priceRule: { mode: "multiplier", value: 0.85 },
      salesByProductId: new Map(),
    });

    expect(result.eligible).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("missing_metric:contentRating");
  });

  it("caps one proposal at twenty products", () => {
    const result = selectPromotionCandidates({
      candidates: Array.from({ length: 25 }, (_, index) => ({
        id: index + 1,
        price: 100,
        action_price: 90,
        max_action_price: 90,
        stock: 10,
      })),
      policy: { all: [{ field: "stock", operator: "gte", value: 1 }] },
      priceRule: { mode: "percent_off", value: 0.1 },
      salesByProductId: new Map(),
    });

    expect(result.eligible).toHaveLength(20);
  });

  it("rejects products when the calculated price is above the Ozon maximum", () => {
    const result = selectPromotionCandidates({
      candidates: [{ id: 10, price: 1_000, action_price: 0, max_action_price: 800, stock: 12 }],
      policy: { all: [{ field: "stock", operator: "gte", value: 1 }] },
      priceRule: { mode: "multiplier", value: 0.9 },
      salesByProductId: new Map(),
    });

    expect(result.eligible).toHaveLength(0);
    expect(result.rejected).toEqual([
      { productId: 10, reason: "action_price_above_ozon_max" },
    ]);
  });

  it("uses Ozon max price when the confirmed rule says so", () => {
    const result = selectPromotionCandidates({
      candidates: [{ id: 10, price: 1_000, action_price: 0, max_action_price: 780, stock: 12 }],
      policy: { all: [{ field: "actionPrice", operator: "lte", value: 800 }] },
      priceRule: { mode: "ozon_max" },
      salesByProductId: new Map(),
    });

    expect(result.eligible).toEqual([
      expect.objectContaining({ productId: 10, actionPrice: 780, maxActionPrice: 780 }),
    ]);
  });
});
