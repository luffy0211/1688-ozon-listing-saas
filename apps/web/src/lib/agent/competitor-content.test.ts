import { describe, expect, it } from "vitest";
import { parseOzonUrl } from "./competitor-content";

describe("competitor content URL parsing", () => {
  it("accepts Ozon product and store URLs", () => {
    expect(parseOzonUrl("https://www.ozon.ru/product/test-123456789/")).toEqual({
      kind: "product",
      url: "https://www.ozon.ru/product/test-123456789/",
      sku: "123456789",
    });
    expect(parseOzonUrl("https://www.ozon.ru/seller/test-shop-123/")).toEqual({
      kind: "store",
      url: "https://www.ozon.ru/seller/test-shop-123/",
    });
  });

  it("rejects non-Ozon URLs", () => {
    expect(() => parseOzonUrl("https://example.com/product/test-123456789/")).toThrow(
      "只支持 ozon.ru 或 ozon.com URL",
    );
  });
});
