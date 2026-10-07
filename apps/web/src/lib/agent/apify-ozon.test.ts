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
    expect(result).toMatchObject({ collectionState: "complete" });
  });

  it.each([
    ["no_results", []],
    ["no_results", [{ ...item, characteristics: [], richDescription: null, hashtags: [] }]],
    ["provider_failed", { error: "Actor failed" }],
    ["provider_failed", [{ error: "Actor failed" }]],
    ["partial", [item, item]],
  ])("reports %s without treating unusable or duplicate items as full evidence", async (collectionState, items) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(items)));
    const [result] = await searchOzonApifyCompetitors({
      apiToken: "test-token", targets: [target], ownSkus: new Set(), limitPerProduct: 3, fetchImpl,
    });
    expect(result).toMatchObject({ collectionState });
    expect(result?.competitors).toHaveLength(collectionState === "partial" ? 1 : 0);
  });

  it.each([503, 401, 429])("marks HTTP %s as provider failure", async (status) => {
    const [result] = await searchOzonApifyCompetitors({
      apiToken: "test-token", targets: [target], ownSkus: new Set(), limitPerProduct: 1,
      fetchImpl: vi.fn().mockResolvedValue(new Response("failed", { status })),
    });
    expect(result).toMatchObject({ collectionState: "provider_failed", competitors: [] });
  });

  it("keeps processing other categories after a timeout", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(new Response(JSON.stringify([item])));
    const results = await searchOzonApifyCompetitors({
      apiToken: "test-token", targets: [target, { ...target, offerId: "second" }],
      ownSkus: new Set(), limitPerProduct: 1, fetchImpl,
    });
    expect(results).toMatchObject([
      { collectionState: "provider_failed", competitors: [] },
      { collectionState: "complete", competitors: [{ sku: "123" }] },
    ]);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 11, "3"])("rejects invalid sample limit %s before fetching", async (limit) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]"));
    await expect(searchOzonApifyCompetitors({
      apiToken: "test-token", targets: [target], ownSkus: new Set(),
      limitPerProduct: limit as number, fetchImpl,
    })).rejects.toThrow("competitor_sample_limit_invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves the bounded detailed request at the maximum supported sample size", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]"));
    await searchOzonApifyCompetitors({
      apiToken: "test-token", targets: [target], ownSkus: new Set(), limitPerProduct: 10, fetchImpl,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({
      maxResults: 12, skipDetails: false, includeSellerDetails: false,
    });
  });

  it("does not call the provider for an unavailable category", async () => {
    const fetchImpl = vi.fn();
    const [result] = await searchOzonApifyCompetitors({
      apiToken: "test-token", targets: [{ ...target, typeId: null }],
      ownSkus: new Set(), limitPerProduct: 1, fetchImpl,
    });
    expect(result).toMatchObject({ collectionState: "unavailable", competitors: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps usable evidence when the provider also reports failed items", async () => {
    const [result] = await searchOzonApifyCompetitors({
      apiToken: "test-token", targets: [target], ownSkus: new Set(), limitPerProduct: 1,
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify([item, { error: "failed detail" }]))),
    });
    expect(result).toMatchObject({ collectionState: "partial", competitors: [{ sku: "123" }] });
  });
});
