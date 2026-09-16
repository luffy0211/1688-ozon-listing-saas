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

  it("calculates formula prices from candidate business fields", () => {
    const candidate = {
      id: 10,
      price: 1_000,
      action_price: 0,
      max_action_price: 850,
      stock: 12,
      cost: 500,
      logistics_fee: 70,
      commission_fee: 60,
    };
    const result = selectPromotionCandidates({
      candidates: [candidate],
      policy: { all: [{ field: "actionPrice", operator: "lte", value: 800 }] },
      priceRule: {
        mode: "formula",
        expression: "cost + logisticsFee + commissionFee + 100",
        rounding: "ceil",
        minProfitRub: 90,
      },
      salesByProductId: new Map(),
    });

    expect(result.eligible).toEqual([
      expect.objectContaining({ productId: 10, actionPrice: 730 }),
    ]);
  });

  it("rejects formula candidates when required business fields are unavailable", () => {
    const result = selectPromotionCandidates({
      candidates: [{ id: 10, price: 1_000, action_price: 0, max_action_price: 850, stock: 12 }],
      policy: { all: [{ field: "stock", operator: "gte", value: 1 }] },
      priceRule: {
        mode: "formula",
        expression: "cost + logisticsFee + 100",
      },
      salesByProductId: new Map(),
    });

    expect(result.eligible).toHaveLength(0);
    expect(result.rejected).toEqual([
      { productId: 10, reason: "missing_formula_variable:cost" },
    ]);
  });

  it("uses saved formula defaults when candidate fields are stable constants", () => {
    const result = selectPromotionCandidates({
      candidates: [{ id: 10, price: 1_000, action_price: 0, max_action_price: 850, stock: 12, cost: 500 }],
      policy: { all: [{ field: "actionPrice", operator: "lte", value: 800 }] },
      priceRule: {
        mode: "formula",
        expression: "(cost + logisticsFee + minProfit) / (1 - commissionRate)",
        defaults: {
          logisticsFee: 80,
          minProfit: 100,
          commissionRate: 0.12,
        },
        rounding: "ceil",
      },
      salesByProductId: new Map(),
    });

    expect(result.eligible).toEqual([
      expect.objectContaining({ productId: 10, actionPrice: 773 }),
    ]);
  });

  it("filters candidates by confirmed product scope and keeps approval context", () => {
    const result = selectPromotionCandidates({
      candidates: [
        {
          id: 10,
          price: 500,
          action_price: 0,
          max_action_price: 450,
          stock: 12,
          offerId: "POLO-001",
          name: "Polo shirt",
          descriptionCategoryId: 200000933,
          typeId: 93194,
        },
        {
          id: 11,
          price: 500,
          action_price: 0,
          max_action_price: 450,
          stock: 12,
          offerId: "DRESS-001",
          descriptionCategoryId: 200000933,
          typeId: 93195,
        },
      ],
      scope: {
        offerIdPrefixes: ["POLO-"],
        categoryKeys: ["200000933:93194"],
        priceRange: { min: 100, max: 600 },
      },
      policy: { all: [{ field: "stock", operator: "gte", value: 1 }] },
      priceRule: { mode: "percent_off", value: 0.1 },
      policyActionId: "policy-1",
      salesByProductId: new Map(),
    });

    expect(result.eligible).toEqual([
      expect.objectContaining({
        productId: 10,
        offerId: "POLO-001",
        name: "Polo shirt",
        categoryKey: "200000933:93194",
        policyActionId: "policy-1",
        actionPrice: 450,
      }),
    ]);
    expect(result.rejected).toEqual([
      { productId: 11, reason: "scope_offer_prefix_mismatch" },
    ]);
  });
});
