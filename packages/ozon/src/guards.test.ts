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
      payload: {
        offer_id: "x",
        description_category_id: 1,
        type_id: 2,
        attributes: [{ id: 85, values: [{ value: "Нет бренда" }] }],
        images: ["https://img.test/main.jpg"],
        weight: 100,
        width: 100,
        height: 100,
        depth: 100,
      },
      duplicateSubmission: true,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("缺少 Ozon 店铺密钥");
    expect(result.failures).toContain("缺少 SKU 主图");
    expect(result.failures).toContain("同店铺同 request_hash 已提交，禁止重复提交");
  });

  it("blocks Ozon payloads with old category shape, Chinese text, bad images, and zero measurements", () => {
    const result = checkSubmitGuards({
      hasOzonCredentials: true,
      hasXiangjiKey: true,
      hasMainImage: true,
      hasDetailImage: true,
      hasPrice: true,
      payload: {
        items: [{
          offer_id: "x",
          name: "中文标题",
          category_id: 1,
          price: "100",
          images: ["http://img.test/main.jpg"],
          attributes: [],
          weight: 0,
          width: 10,
          height: 10,
          depth: 10,
        }],
      },
      duplicateSubmission: false,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("payload 缺少有效 description_category_id");
    expect(result.failures).toContain("payload 缺少有效 type_id");
    expect(result.failures).toContain("payload attributes 为空");
    expect(result.failures).toContain("payload 图片必须是 HTTPS 公网链接");
    expect(result.failures).toContain("payload weight 必须大于 0");
    expect(result.failures).toContain("payload 含中文字段: items[0].name");
  });
});
