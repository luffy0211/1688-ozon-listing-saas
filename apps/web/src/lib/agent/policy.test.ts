import { describe, expect, it } from "vitest";
import {
  actionApprovalPolicy,
  actionNeedsApproval,
  evaluateProfitGuardrail,
  isRecommendationOnly,
  redactSensitiveText,
} from "./policy";

describe("agent policy", () => {
  it("blocks price updates when cost is missing", () => {
    const result = evaluateProfitGuardrail({
      actionType: "UPDATE_PRICE",
      proposedPriceRub: 1000,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_cost");
  });

  it("blocks price updates under the profit floor", () => {
    const result = evaluateProfitGuardrail({
      actionType: "UPDATE_PRICE",
      proposedPriceRub: 500,
      costRub: 400,
      commissionRate: 0.15,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("profit_guardrail_failed");
  });

  it("allows profitable price updates", () => {
    const result = evaluateProfitGuardrail({
      actionType: "UPDATE_PRICE",
      proposedPriceRub: 1200,
      costRub: 650,
      commissionRate: 0.15,
    });

    expect(result.allowed).toBe(true);
    expect(result.profitRub).toBe(370);
    expect(result.grossMarginRate).toBeCloseTo(0.3083, 3);
  });

  it("redacts common API secret patterns", () => {
    const text = redactSensitiveText(
      "Api-Key: my-secret-key\nauthorization: Bearer token-value\nsk-1234567890abcdef",
    );

    expect(text).not.toContain("my-secret-key");
    expect(text).not.toContain("token-value");
    expect(text).not.toContain("sk-1234567890abcdef");
    expect(text).toContain("[REDACTED]");
  });

  it("requires approval for all mutating Ozon actions", () => {
    for (const actionType of [
      "UPDATE_PRICE",
      "UPDATE_STOCK",
      "UPDATE_IMAGES",
      "UPDATE_ATTRIBUTES",
      "UPDATE_CATEGORY",
      "PUBLISH_DRAFT",
      "CONTENT_DRAFT",
      "ARCHIVE_PRODUCT",
      "UNARCHIVE_PRODUCT",
      "DELETE_PRODUCT",
      "BULK_PRODUCT_UPDATE",
    ] as const) {
      expect(actionNeedsApproval(actionType)).toBe(true);
      expect(actionApprovalPolicy(actionType)).toMatchObject({
        operationKind: "mutation",
        approvalRequired: true,
        canExecuteWithoutApproval: false,
      });
    }
  });

  it("keeps recommendation actions out of the execution path", () => {
    for (const actionType of ["RESTOCK_RECOMMENDATION", "PROMO_RECOMMENDATION"] as const) {
      expect(isRecommendationOnly(actionType)).toBe(true);
      expect(actionNeedsApproval(actionType)).toBe(false);
      expect(actionApprovalPolicy(actionType)).toMatchObject({
        operationKind: "recommendation",
        approvalRequired: false,
        canExecuteWithoutApproval: false,
      });
    }
  });
});
