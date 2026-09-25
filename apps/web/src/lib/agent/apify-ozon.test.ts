import { describe, expect, it, vi } from "vitest";
import { parseApifyOzonProduct, searchOzonApifyCompetitors } from "./apify-ozon";

const target = {
  offerId: "own-polo",
  title: "Мужское поло",
  publicSku: "999",
  quantity: 0,
  revenueRub: 0,
  descriptionCategoryId: 10,
  typeId: 93194,
  categoryNameRu: "Поло",
  categoryPathRu: ["Одежда", "Мужская одежда", "Поло"],
};

const item = {
  sku: "123",
  url: "https://www.ozon.ru/product/polo-123/",
  title: "Поло мужское из хлопка",
  cardPriceDecimal: 1200,
  rating: 4.8,
  reviewCount: 42,
  coverImageUrl: "https://ir-20.ozone.ru/s3/multimedia-1-1/123.jpg",
  images: ["https://ir-20.ozone.ru/s3/multimedia-1-1/123.jpg"],
  characteristics: [{ name: "Тип", value: "Поло" }],
  richDescription: "Мужское поло из хлопка для города",
  hashtags: ["#поло"],
  seller: { name: "Test seller" },
};

describe("Apify Ozon adapter", () => {
  it("normalizes the fields from the previously used Zen Studio actor", () => {
    expect(parseApifyOzonProduct(item, 1)).toMatchObject({
      sku: "123",
      priceRub: 1200,
      imageUrls: ["https://ir-20.ozone.ru/s3/multimedia-1-1/123.jpg"],
      attributes: { "Тип": "Поло", "Хештеги": "#поло" },
      description: "Мужское поло из хлопка для города",
      categoryPosition: 1,
    });
    expect(parseApifyOzonProduct({ ...item, url: "https://example.com/item" }, 1)).toBeNull();
  });

  it("queries the own category and excludes unrelated or own products", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(init.headers).toMatchObject({ authorization: "Bearer test-token" });
      expect(JSON.parse(String(init.body))).toMatchObject({
        queries: ["Мужская одежда Поло"],
        maxResults: 3,
        skipDetails: false,
      });
      return new Response(JSON.stringify([
        { ...item, sku: "999" },
        { ...item, sku: "456", characteristics: [{ name: "Тип", value: "Рубашка" }] },
        item,
      ]), { status: 200 });
    });
    const [result] = await searchOzonApifyCompetitors({
      apiToken: "test-token",
      targets: [target],
      ownSkus: new Set(["999"]),
      limitPerProduct: 1,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result?.competitors.map((product) => product.sku)).toEqual(["123"]);
  });
});
