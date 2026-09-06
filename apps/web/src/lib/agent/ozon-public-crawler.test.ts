import { describe, expect, it } from "vitest";
import {
  buildCompetitorBenchmarks,
  extractCategoryProducts,
  extractProductPage,
  extractSecondLevelCategory,
  crawlOzonCategoryCompetitors,
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
        "webGallery-1": { images: ["https://cdn.test/own-1.jpg"] },
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
            images: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg", "https://cdn.test/c.jpg"],
          },
          "webReviewProductScore-1": { totalScore: "4.8", reviewsCount: "300" },
          "webCharacteristics-1": {
            characteristics: [
              { name: "Материал", values: [{ text: "Шифон" }] },
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
            images: ["https://cdn.test/d.jpg", "https://cdn.test/e.jpg"],
          },
          "webReviewProductScore-1": { totalScore: "4.9", reviewsCount: "500" },
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
  });
});
