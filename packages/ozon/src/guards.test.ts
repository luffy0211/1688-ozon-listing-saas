import { describe, expect, it } from "vitest";
import { checkSubmitGuards, collectStockFields } from "./guards";

describe("Ozon submit guards", () => {
  it("finds stock and warehouse fields recursively", () => {
    expect(
      collectStockFields({
        items: [{ offer_id: "x", stocks: [{ warehouse: "ru", present: 1 }] }],
      }),
    ).toEqual(["items[0].stocks", "items[0].stocks[0].warehouse"]);
  });

  it("blocks duplicate submissions and missing required data", () => {
    const result = checkSubmitGuards({
      hasOzonCredentials: false,
      hasXiangjiKey: true,
      hasMainImage: false,
      hasDetailImage: true,
      hasPrice: true,
      payload: { offer_id: "x" },
      duplicateSubmission: true,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("缺少 Ozon 店铺密钥");
    expect(result.failures).toContain("缺少 SKU 主图");
    expect(result.failures).toContain("同店铺同 request_hash 已提交，禁止重复提交");
  });
});
