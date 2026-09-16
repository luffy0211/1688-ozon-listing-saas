import { describe, expect, it } from "vitest";
import {
  calculatePromotionActionPrice,
  evaluate,
  promotionPolicySchema,
  promotionPriceRuleSchema,
} from "./promotion-policy";

describe("promotion policy", () => {
  it("passes when every condition matches", () => {
    expect(
      evaluate(
        {
          all: [
            { field: "stock", operator: "gte", value: 10 },
            { field: "currentPrice", operator: "lte", value: 1_000 },
            { field: "maxActionPrice", operator: "eq", value: 900 },
            { field: "contentRating", operator: "in", value: [4, 5] },
          ],
        },
        {
          stock: 12,
          currentPrice: 999,
          maxActionPrice: 900,
          contentRating: 5,
        },
      ),
    ).toEqual({ passed: true, reason: null });
  });

  it("fails when any condition does not match", () => {
    expect(
      evaluate(
        {
          all: [
            { field: "orders30d", operator: "gte", value: 5 },
            { field: "discountRate", operator: "not_in", value: [0, 0.1] },
          ],
        },
        { orders30d: 5, discountRate: 0.1 },
      ),
    ).toEqual({
      passed: false,
      reason: "condition_failed:discountRate:not_in",
    });
  });

  it("fails with a reason when a required metric is missing", () => {
    expect(
      evaluate(
        { all: [{ field: "revenue30d", operator: "eq", value: 2_000 }] },
        {},
      ),
    ).toEqual({ passed: false, reason: "missing_metric:revenue30d" });
  });

  it.each([
    { all: [] },
    { all: [{ field: "profit", operator: "gte", value: 1 }] },
    { all: [{ field: "stock", operator: "exec", value: 1 }] },
    { all: [{ field: "stock", operator: "in", value: 1 }] },
    { all: [{ field: "stock", operator: "gte", value: [1] }] },
    { all: [{ field: "stock", operator: "in", value: [1], code: "alert(1)" }] },
  ])("rejects an invalid rule: $all", (rule) => {
    expect(promotionPolicySchema.safeParse(rule).success).toBe(false);
    expect(evaluate(rule, { stock: 1 })).toEqual({
      passed: false,
      reason: "invalid_rule",
    });
  });

  it.each([
    { mode: "multiplier", value: 0.9 },
    { mode: "percent_off", value: 0.15 },
    { mode: "amount_off", value: 50 },
    { mode: "fixed", value: 799 },
    { mode: "ozon_max" },
    { mode: "formula", expression: "cost + logisticsFee + commissionFee + minProfit", rounding: "ceil" },
  ])("accepts a safe activity price rule: $mode", (rule) => {
    expect(promotionPriceRuleSchema.safeParse(rule).success).toBe(true);
  });

  it.each([
    { mode: "multiplier", value: 1.2 },
    { mode: "percent_off", value: 1 },
    { mode: "amount_off", value: -10 },
    { mode: "fixed", value: 0 },
    { mode: "script", value: 1 },
  ])("rejects an unsafe activity price rule: $mode", (rule) => {
    expect(promotionPriceRuleSchema.safeParse(rule).success).toBe(false);
  });

  it("calculates a custom formula with profit guardrails", () => {
    expect(
      calculatePromotionActionPrice(
        {
          mode: "formula",
          expression: "cost + logisticsFee + commissionFee + minProfit",
          rounding: "ceil",
          minProfitRub: 40,
          minGrossMarginRate: 0.1,
        },
        {
          currentPrice: 1_000,
          maxActionPrice: 900,
          cost: 500,
          logisticsFee: 80,
          commissionFee: 60,
          minProfit: 100,
        },
      ),
    ).toEqual({ passed: true, actionPrice: 740 });
  });

  it("rejects formula variables outside the whitelist", () => {
    expect(
      calculatePromotionActionPrice(
        { mode: "formula", expression: "process + 1" },
        { currentPrice: 1_000 },
      ),
    ).toEqual({ passed: false, reason: "unknown_formula_variable:process" });
  });

  it("rejects formulas when a required business variable is missing", () => {
    expect(
      calculatePromotionActionPrice(
        { mode: "formula", expression: "cost + logisticsFee" },
        { currentPrice: 1_000, cost: 500 },
      ),
    ).toEqual({ passed: false, reason: "missing_formula_variable:logisticsFee" });
  });

  it("uses saved default variables for stable user formulas", () => {
    expect(
      calculatePromotionActionPrice(
        {
          mode: "formula",
          expression: "(cost + logisticsFee + minProfit) / (1 - commissionRate)",
          defaults: {
            logisticsFee: 80,
            minProfit: 100,
            commissionRate: 0.12,
          },
          rounding: "ceil",
        },
        { cost: 500 },
      ),
    ).toEqual({ passed: true, actionPrice: 773 });
  });
});
