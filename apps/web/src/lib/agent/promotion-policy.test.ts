import { describe, expect, it } from "vitest";
import { evaluate, promotionPolicySchema } from "./promotion-policy";

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
});
