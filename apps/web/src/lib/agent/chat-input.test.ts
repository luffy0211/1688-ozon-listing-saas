import { describe, expect, it } from "vitest";
import { extractOfferId, extractOzonUrls } from "./chat-input";

describe("agent chat input parsing", () => {
  it("extracts Ozon product URLs from free-form chat text", () => {
    expect(
      extractOzonUrls(
        "分析 offerId ABC123，对比 https://www.ozon.ru/product/test-123456789/ 和 https://ozon.com/product/sku-987654321?x=1。",
      ),
    ).toEqual([
      "https://www.ozon.ru/product/test-123456789/",
      "https://ozon.com/product/sku-987654321?x=1",
    ]);
  });

  it("extracts own offerId from common operator phrasing", () => {
    expect(extractOfferId("分析 offerId: ABC-123_45")).toBe("ABC-123_45");
    expect(extractOfferId("分析 offerId ABC-123_45")).toBe("ABC-123_45");
    expect(extractOfferId("自家商品 XYZ789 对比这个竞品")).toBe("XYZ789");
    expect(extractOfferId("自家商品是 XYZ789 对比这个竞品")).toBe("XYZ789");
    expect(extractOfferId("货号：SKU.2026.08")).toBe("SKU.2026.08");
    expect(extractOfferId("针对 F926082212s-0A-XXL 生成具体标题和描述优化草案")).toBe("F926082212s-0A-XXL");
  });

  it("returns null when there is no own product identifier", () => {
    expect(extractOfferId("只看一下这个竞品链接")).toBeNull();
  });
});
