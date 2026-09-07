import { describe, expect, it, vi } from "vitest";
import {
  parseIndexedOzonProduct,
  searchOzonIndexedCompetitors,
} from "./ozon-search-index";

const indexedProduct = {
  title: "Поло Mark Formelle для мужчин купить на OZON по низкой цене!",
  url: "https://www.ozon.ru/product/polo-mark-formelle-1607177448/",
  content: "Поло мужское из хлопка",
  raw_content: `
# Поло Mark Formelle для мужчин
4.9 • 175 отзывов
1 311 ₽
О товаре
Сезон
На любой сезон
Материал
Пике
Состав материала
100% хлопок
Коллекция
Весна-лето 2024
Стиль
Повседневный
Описание
Мужское поло прямого кроя из хлопкового пике.
Отзывы
`,
};

describe("Ozon search index", () => {
  it("requires a Tavily API key", async () => {
    await expect(searchOzonIndexedCompetitors({
      apiKey: "",
      targets: [],
      ownSkus: new Set(),
    })).rejects.toThrow("tavily_api_key_missing");
  });

  it("parses indexed Ozon attributes and description", () => {
    expect(parseIndexedOzonProduct(indexedProduct, 1)).toEqual(expect.objectContaining({
      sku: "1607177448",
      title: "Поло Mark Formelle для мужчин",
      priceRub: 1311,
      rating: 4.9,
      reviewCount: 175,
      attributes: {
        "Сезон": "На любой сезон",
        "Материал": "Пике",
        "Состав материала": "100% хлопок",
        "Коллекция": "Весна-лето 2024",
        "Стиль": "Повседневный",
      },
      description: "Мужское поло прямого кроя из хлопкового пике.",
      categoryPosition: 1,
    }));
    expect(parseIndexedOzonProduct({ ...indexedProduct, url: "https://example.com/product/1/" }, 1)).toBeNull();
    expect(parseIndexedOzonProduct({
      ...indexedProduct,
      raw_content: "Материал\nСостав материала\n100% хлопок",
    }, 1)?.attributes).toEqual({ "Состав материала": "100% хлопок" });
  });

  it("queries only the Ozon index and excludes own products", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      results: [
        { ...indexedProduct, url: "https://www.ozon.ru/product/own-100/" },
        indexedProduct,
        { ...indexedProduct, url: "https://ozon.ru/product/polo-mark-formelle-1607177448/" },
        { ...indexedProduct, url: "https://example.com/product/other-200/" },
      ],
    }), { status: 200 }));

    const [result] = await searchOzonIndexedCompetitors({
      apiKey: "test-key",
      targets: [{ offerId: "own", title: "Мужское поло", publicSku: "100", quantity: 0, revenueRub: 0 }],
      ownSkus: new Set(["100"]),
      limitPerProduct: 5,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      include_domains: ["ozon.ru"],
      include_raw_content: "text",
      max_results: 10,
    });
    expect(result?.competitors.map((item) => item.sku)).toEqual(["1607177448"]);
    expect(result?.category?.name).toBe("Мужское поло");
  });

  it("keeps other products when one search response is malformed", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [indexedProduct] }), { status: 200 }));

    const results = await searchOzonIndexedCompetitors({
      apiKey: "test-key",
      targets: [
        { offerId: "bad", title: "Мужское поло", publicSku: "100", quantity: 0, revenueRub: 0 },
        { offerId: "good", title: "Мужское поло", publicSku: "200", quantity: 0, revenueRub: 0 },
      ],
      ownSkus: new Set(["100", "200"]),
      fetchImpl,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.warnings[0]).toContain("tavily_invalid_results");
    expect(results[1]?.competitors).toHaveLength(1);
  });
});
