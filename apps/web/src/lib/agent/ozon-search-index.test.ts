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

const target = (offerId: string, publicSku: string) => ({
  offerId,
  title: "任意自家标题",
  publicSku,
  quantity: 0,
  revenueRub: 0,
  descriptionCategoryId: 17027904,
  typeId: 93337,
  categoryNameRu: "Поло",
  categoryPathRu: ["Одежда", "Мужская одежда", "Поло"],
});

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
      url: "https://ozon.ru/product/polo-mark-formelle-1607177448/features",
    }, 1)).toEqual(expect.objectContaining({
      sku: "1607177448",
      url: "https://www.ozon.ru/product/polo-mark-formelle-1607177448/",
    }));
    expect(parseIndexedOzonProduct({
      ...indexedProduct,
      raw_content: "Материал\nСостав материала\n100% хлопок",
    }, 1)?.attributes).toEqual({ "Состав материала": "100% хлопок" });
  });

  it("parses arbitrary category attributes from the characteristics section", () => {
    const result = parseIndexedOzonProduct({
      ...indexedProduct,
      raw_content: `
# Электрический чайник
Характеристики
Объем, л
1.7
Мощность, Вт
2200
Материал корпуса
Стекло
Описание
Чайник с подсветкой.
Отзывы
`,
    }, 1);

    expect(result?.attributes).toEqual({
      "Объем, л": "1.7",
      "Мощность, Вт": "2200",
      "Материал корпуса": "Стекло",
    });
  });

  it("parses Tavily inline feature snippets without mixing adjacent fields", () => {
    const result = parseIndexedOzonProduct({
      ...indexedProduct,
      raw_content: null,
      content: "Сезон: На любой сезон. Материал: Хлопок. Состав материала: 100% хлопок. Коллекция: Базовая коллекция. Тип: Поло. Бренд в одежде и обуви: Polo Ralph Lauren. Описание: Мужское хлопковое поло.",
    }, 1);

    expect(result?.attributes).toEqual({
      "Сезон": "На любой сезон",
      "Материал": "Хлопок",
      "Состав материала": "100% хлопок",
      "Коллекция": "Базовая коллекция",
      "Тип": "Поло",
      "Бренд в одежде и обуви": "Polo Ralph Lauren",
    });
    expect(result?.description).toBe("Мужское хлопковое поло");
  });

  it("queries only the Ozon index and excludes own products", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      results: [
        { ...indexedProduct, url: "https://www.ozon.ru/product/own-100/" },
        indexedProduct,
        { ...indexedProduct, url: "https://ozon.ru/product/polo-mark-formelle-1607177448/" },
        { ...indexedProduct, title: "Платье женское", url: "https://www.ozon.ru/product/dress-200/" },
        { ...indexedProduct, url: "https://example.com/product/other-300/" },
      ],
    }), { status: 200 }));

    const [result] = await searchOzonIndexedCompetitors({
      apiKey: "test-key",
      targets: [target("own", "100")],
      ownSkus: new Set(["100"]),
      limitPerProduct: 5,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      query: expect.stringContaining("Поло"),
      include_domains: ["ozon.ru"],
      include_raw_content: "text",
      max_results: 10,
    });
    expect(result?.competitors.map((item) => item.sku)).toEqual(["1607177448"]);
    expect(result?.category?.name).toBe("Поло");
  });

  it("searches once per official category and rejects products from another type", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [
        indexedProduct,
        { ...indexedProduct, title: "Платье женское", url: "https://www.ozon.ru/product/dress-200/" },
      ],
    }), { status: 200 }));

    const results = await searchOzonIndexedCompetitors({
      apiKey: "test-key",
      targets: [target("one", "100"), target("two", "101")],
      ownSkus: new Set(["100", "101"]),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.competitors.map((item) => item.sku).join() === "1607177448")).toBe(true);
    expect(results[0]?.warnings).toContain("已过滤 1 个无法证明属于 Поло 的搜索结果");
  });

  it("does not confuse different Russian product types with the same prefix", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { ...indexedProduct, title: "Кроссовки женские", url: "https://www.ozon.ru/product/shoes-300/" },
        { ...indexedProduct, title: "Сумка кроссбоди женская", url: "https://www.ozon.ru/product/bag-301/" },
      ],
    }), { status: 200 }));

    const [result] = await searchOzonIndexedCompetitors({
      apiKey: "test-key",
      targets: [{
        ...target("shoes", "302"),
        typeId: 44,
        categoryNameRu: "Кроссовки",
        categoryPathRu: ["Обувь", "Женская обувь", "Кроссовки"],
      }],
      ownSkus: new Set(["302"]),
      fetchImpl,
    });

    expect(result?.competitors.map((item) => item.sku)).toEqual(["300"]);
  });

  it("accepts either product type from a compound official category", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { ...indexedProduct, title: "Блузка женская", url: "https://www.ozon.ru/product/blouse-400/" },
        { ...indexedProduct, title: "Рубашка женская", url: "https://www.ozon.ru/product/shirt-401/" },
        { ...indexedProduct, title: "Брюки женские", url: "https://www.ozon.ru/product/trousers-402/" },
      ],
    }), { status: 200 }));

    const [result] = await searchOzonIndexedCompetitors({
      apiKey: "test-key",
      targets: [{
        ...target("tops", "403"),
        typeId: 45,
        categoryNameRu: "Блузки и рубашки",
        categoryPathRu: ["Одежда", "Женская одежда", "Блузки и рубашки"],
      }],
      ownSkus: new Set(["403"]),
      fetchImpl,
    });

    expect(result?.competitors.map((item) => item.sku)).toEqual(["400", "401"]);
  });

  it("keeps other products when one search response is malformed", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [indexedProduct] }), { status: 200 }));

    const results = await searchOzonIndexedCompetitors({
      apiKey: "test-key",
      targets: [
        { ...target("bad", "100"), typeId: 1 },
        { ...target("good", "200"), typeId: 2 },
      ],
      ownSkus: new Set(["100", "200"]),
      fetchImpl,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.warnings[0]).toContain("tavily_invalid_results");
    expect(results[1]?.competitors).toHaveLength(1);
  });
});
