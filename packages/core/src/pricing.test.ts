import { describe, expect, it } from "vitest";
import { computeSalePriceRub } from "./pricing";

describe("computeSalePriceRub", () => {
  it("uses the v1 pricing formula and rounds up to 10 RUB", () => {
    expect(
      computeSalePriceRub({
        purchaseCny: 20,
        domesticShippingCny: 5,
        packagingCny: 1,
        cnyToRub: 12,
        internationalShippingRub: 120,
        commissionRate: 0.15,
        targetMarginRate: 0.2,
      }),
    ).toBe(670);
  });

  it("rejects impossible commission and margin totals", () => {
    expect(() =>
      computeSalePriceRub({
        purchaseCny: 20,
        domesticShippingCny: 0,
        packagingCny: 0,
        cnyToRub: 12,
        internationalShippingRub: 0,
        commissionRate: 0.6,
        targetMarginRate: 0.4,
      }),
    ).toThrow("小于 1");
  });
});
