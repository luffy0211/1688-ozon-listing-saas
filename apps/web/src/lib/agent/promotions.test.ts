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
      salesByProductId: new Map(),
    });

    expect(result.eligible).toHaveLength(20);
  });
});
