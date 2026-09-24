import { describe, expect, it } from "vitest";
import {
  buildCompetitorBenchmarks,
  extractCategoryProducts,
  extractProductPage,
  extractSecondLevelCategory,
  isUsableCompetitorEvidence,
  crawlOzonCategoryCompetitors,
  mergeCategoryCardWithDetail,
} from "./ozon-public-crawler";

const states = (entries: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]),
  );

describe("Ozon public category crawler", () => {
  it("uses the second category breadcrumb from the own product page", () => {
    const category = extractSecondLevelCategory(
      states({
        "webBreadCrumbs-1": {
          breadcrumbs: [
            { text: "Одежда", link: "/category/odezhda-7500/" },
            { text: "Женская одежда", link: "/category/zhenskaya-odezhda-7501/" },
            { text: "Платья", link: "/category/platya-7502/" },
          ],
        },
      }),
    );

    expect(category).toEqual({
      name: "Женская одежда",
      url: "https://www.ozon.ru/category/zhenskaya-odezhda-7501/",
      path: ["Одежда", "Женская одежда", "Платья"],
    });
  });

  it.skipIf(!process.env.OZON_CRAWLER_LIVE_SKU)(
    "reads a live public product and keeps competitors in the same second-level category",
    async () => {
      const sku = process.env.OZON_CRAWLER_LIVE_SKU!;
      const [result] = await crawlOzonCategoryCompetitors({
        targets: [{ offerId: "live-check", title: "Live check", publicSku: sku, quantity: 0, revenueRub: 0 }],
        ownSkus: new Set([sku]),
        limitPerProduct: 1,
      });

      expect(result?.category?.url).toContain("/category/");
      expect(result?.competitors.length).toBeGreaterThan(0);
    },
    120_000,
  );

  it("extracts category cards and excludes own and duplicate SKUs", () => {
    const products = extractCategoryProducts(
      states({
        "tileScrollDesktop-1": {
          items: [{ sku: 999, title: "Unrelated recommendation" }],
        },
        "searchResultsV2-1": {
          items: [
            {
              sku: 100,
              action: { link: "/product/own-dress-100/?from=category" },
              title: "Own dress",
              mainState: [{ priceV2: { price: [{ text: "1 990 ₽" }] } }],
            },
            {
              sku: 200,
              action: { link: "/product/summer-dress-200/" },
              mainState: [
                { priceV2: { price: [{ text: "1 590 ₽" }, { text: "2 490 ₽" }] } },
                { id: "name", textDS: { text: "Summer dress" } },
                { labelListV2: { items: [{ text: { text: "4.8" } }, { text: { text: "321 отзыв" } }] } },
              ],
            },
            {
              sku: 200,
              action: { link: "/product/summer-dress-200/?duplicate=1" },
              title: "Duplicate",
            },
          ],
        },
      }),
      new Set(["100"]),
    );

    expect(products).toEqual([
      expect.objectContaining({
        sku: "200",
        title: "Summer dress",
        priceRub: 1590,
        oldPriceRub: 2490,
        rating: 4.8,
        reviewCount: 321,
        categoryPosition: 2,
      }),
    ]);
  });

  it("extracts comparable details and builds evidence-based benchmarks", () => {
    const own = extractProductPage(
      states({
        "webProductHeading-1": { title: "Платье женское" },
        "webPrice-1": { price: "1 990 ₽", originalPrice: "2 500 ₽" },
        "webGallery-1": { images: ["https://ir.ozone.ru/s3/own-1.jpg"] },
        "webCharacteristics-1": {
          characteristics: [{ name: "Материал", values: [{ text: "Полиэстер" }] }],
        },
      }),
      "100",
    );
    const competitors = [
      extractProductPage(
        states({
          "webProductHeading-1": { title: "Платье женское летнее шифоновое" },
          "webPrice-1": { price: "1 500 ₽" },
          "webGallery-1": {
            images: ["https://ir.ozone.ru/s3/a.jpg", "https://ir.ozone.ru/s3/b.jpg", "https://ir.ozone.ru/s3/c.jpg"],
          },
          "webReviewProductScore-1": { totalScore: "4.8", reviewsCount: "300" },
          "webDescription-1": { description: "Легкое летнее платье из шифона для прогулок." },
          "webCharacteristics-1": {
            characteristics: [
              { name: "Материал", values: [{ text: "Шифон" }, { text: "Полиэстер" }] },
              { name: "Сезон", values: [{ text: "Лето" }] },
            ],
          },
        }),
        "200",
      ),
      extractProductPage(
        states({
          "webProductHeading-1": { title: "Платье женское летнее вечернее" },
          "webPrice-1": { price: "1 700 ₽" },
          "webGallery-1": {
            images: ["https://ir.ozone.ru/s3/d.jpg", "https://ir.ozone.ru/s3/e.jpg"],
          },
          "webReviewProductScore-1": { totalScore: "4.9", reviewsCount: "500" },
          "webDescription-1": { description: "Вечернее шифоновое платье с легким силуэтом." },
          "webCharacteristics-1": {
            characteristics: [
              { name: "Материал", values: [{ text: "Шифон" }] },
              { name: "Сезон", values: [{ text: "Лето" }] },
            ],
          },
        }),
        "300",
      ),
    ];

    const result = buildCompetitorBenchmarks(own, competitors);

    expect(result.price).toMatchObject({ ownRub: 1990, medianRub: 1600, differenceRate: 0.24375 });
    expect(result.rating).toEqual({ median: 4.85, reviewCountMedian: 400 });
    expect(result.images).toEqual({ ownCount: 1, medianCount: 2.5 });
    expect(result.missingTitleTerms).toContain("летнее");
    expect(result.missingAttributes).toContain("Сезон");
    expect(result.content.attributePatterns).toEqual(expect.arrayContaining([
      {
        name: "Материал",
        coverageCount: 2,
        coverageRate: 1,
        commonValues: [{ value: "Шифон", count: 2 }, { value: "Полиэстер", count: 1 }],
      },
      {
        name: "Сезон",
        coverageCount: 2,
        coverageRate: 1,
        commonValues: [{ value: "Лето", count: 2 }],
      },
    ]));
    expect(result.content.descriptions.availableCount).toBe(2);
    expect(result.content.descriptions.samples).toEqual([
      expect.objectContaining({ sku: "200", text: expect.stringContaining("летнее платье") }),
      expect.objectContaining({ sku: "300", text: expect.stringContaining("шифоновое платье") }),
    ]);
  });

  it("keeps content evidence when price and rating are unavailable", () => {
    const product = (sku: string, attributes: Record<string, string>, description: string | null) => ({
      sku,
      url: `https://www.ozon.ru/product/${sku}/`,
      title: "Мужское поло",
      priceRub: null,
      oldPriceRub: null,
      rating: null,
      reviewCount: null,
      sellerName: null,
      imageUrls: [],
      attributes,
      description,
      reviews: [],
    });
    const result = buildCompetitorBenchmarks(product("own", {}, null), [
      product("1", { Материал: "Хлопок" }, "Базовое хлопковое поло для повседневной носки."),
      product("2", { Материал: "Хлопок" }, "Мужское поло прямого кроя."),
    ]);

    expect(result.price.medianRub).toBeNull();
    expect(result.rating).toEqual({ median: null, reviewCountMedian: null });
    expect(result.content.attributePatterns[0]).toMatchObject({
      name: "Материал",
      coverageRate: 1,
      commonValues: [{ value: "Хлопок", count: 2 }],
    });
    expect(result.content.descriptions.availableCount).toBe(2);
  });

  it("rejects Ozon error pages and demographic mismatches as competitor evidence", () => {
    const product = {
      sku: "1",
      url: "https://www.ozon.ru/product/1/",
      title: "Характеристики Худи",
      priceRub: null,
      oldPriceRub: null,
      rating: null,
      reviewCount: null,
      sellerName: null,
      imageUrls: [],
      attributes: { "Image 1": "warning\nПохоже, нет соединения\nВыключите VPN\nИнцидент: test" },
      description: null,
      reviews: [],
    };

    expect(isUsableCompetitorEvidence(product, {
      offerId: "own",
      title: "Мужское худи",
      publicSku: "own-sku",
      quantity: 0,
      revenueRub: 0,
      categoryNameRu: "Худи",
      gender: "Мужской",
      ageGroup: "Взрослые",
    })).toBe(false);

    expect(isUsableCompetitorEvidence({
      ...product,
      title: "Характеристики Поло Polo Ralph Lauren одежда мужская 1 шт",
      attributes: { Тип: "Поло", Пол: "Мужской" },
    }, {
      offerId: "own",
      title: "Мужское поло",
      publicSku: "own-sku",
      quantity: 0,
      revenueRub: 0,
      categoryNameRu: "Поло",
      gender: "Мужской",
      ageGroup: "Взрослые",
    })).toBe(false);

    expect(isUsableCompetitorEvidence({
      ...product,
      title: "Рубашка Gloria Jeans для мальчиков подростков",
      attributes: { Тип: "Рубашка", Пол: "Мужской" },
    }, {
      offerId: "own",
      title: "Мужская рубашка",
      publicSku: "own-sku",
      quantity: 0,
      revenueRub: 0,
      categoryNameRu: "Рубашка",
      gender: "Мужской",
      ageGroup: "Взрослые",
    })).toBe(false);
  });

  it("enriches only attributes and description from product detail", () => {
    const card = {
      sku: "200",
      url: "https://www.ozon.ru/product/summer-dress-200/",
      title: "Summer dress",
      priceRub: 1590,
      oldPriceRub: 2490,
      rating: 4.8,
      reviewCount: 321,
      sellerName: null,
      imageUrls: ["https://ir.ozone.ru/s3/card.jpg"],
      attributes: {},
      description: null,
      reviews: [],
      categoryPosition: 2,
    };
    const detail = {
      ...card,
      url: "https://www.ozon.ru/product/200/",
      sellerName: "Fashion Store",
      imageUrls: ["https://ir.ozone.ru/s3/detail-1.jpg", "https://ir.ozone.ru/s3/detail-2.jpg"],
      attributes: { Материал: "Шифон", Сезон: "Лето" },
      description: "Летнее платье",
      reviews: [{ rating: 5, text: "Хорошее платье" }],
      categoryPosition: undefined,
    };

    expect(mergeCategoryCardWithDetail(card, detail)).toEqual(expect.objectContaining({
      url: card.url,
      categoryPosition: 2,
      title: card.title,
      priceRub: card.priceRub,
      sellerName: null,
      attributes: detail.attributes,
      description: detail.description,
      reviews: [],
      imageUrls: card.imageUrls,
    }));
  });
});
