import { describe, expect, it } from "vitest";
import {
  buildOzonCrawlerJob,
  crawlOzonCompetitorsWithProcess,
  parseOzonCrawlerOutput,
} from "./ozon-crawler-process";

const target = {
  offerId: "own-offer",
  title: "Мужское поло",
  publicSku: "999",
  quantity: 3,
  revenueRub: 1200,
  descriptionCategoryId: 200000933,
  typeId: 93194,
  categoryNameRu: "Поло",
  categoryPathRu: ["Одежда", "Мужская одежда", "Поло"],
};

describe("Ozon crawler process adapter", () => {
  it("builds the crawler job from official Ozon category targets", () => {
    expect(buildOzonCrawlerJob({
      requestId: "run-1",
      targets: [target],
      ownSkus: new Set(["999"]),
      topN: 3,
      scanPages: 4,
    })).toEqual({
      requestId: "run-1",
      topN: 3,
      scanPages: 4,
      categories: [{
        categoryKey: "200000933:93194",
        descriptionCategoryId: 200000933,
        typeId: 93194,
        categoryNameRu: "Поло",
        gender: "Мужской",
        ageGroup: "Взрослые",
        productType: "Поло",
      }],
      excludeSkus: ["999"],
    });
  });

  it("uses a category query instead of falling back to menswear for general categories", () => {
    const job = buildOzonCrawlerJob({
      requestId: "run-2",
      targets: [{
        ...target,
        descriptionCategoryId: 100,
        typeId: 200,
        categoryNameRu: "Настольная лампа",
        categoryPathRu: ["Дом и сад", "Освещение", "Настольная лампа"],
      }],
      ownSkus: new Set(),
      topN: 2,
      scanPages: 2,
    });

    expect(job.categories[0]).toMatchObject({
      categoryKey: "100:200",
      productType: "Настольная лампа",
      ozonQuery: "Освещение Настольная лампа",
    });
    expect(job.categories[0]).not.toHaveProperty("gender");
  });

  it("maps validated crawler output into competitor evidence", () => {
    const [result] = parseOzonCrawlerOutput({
      requestId: "run-1",
      capturedAt: "2026-09-10T00:00:00Z",
      rankingType: "public_popularity_proxy",
      categories: [{
        categoryKey: "200000933:93194",
        scannedCount: 20,
        eligibleCount: 18,
        filteredMismatchedCount: 2,
        warnings: [],
        competitors: [{
          publicRank: 1,
          sku: "123",
          url: "https://www.ozon.ru/product/123/",
          title: "Поло из хлопка",
          description: "Мужское поло на каждый день.",
          priceRub: 1499,
          rating: 4.9,
          reviewCount: 12000,
          hotBadge: false,
          popularityProxy: true,
          sellerName: "Seller",
          attributes: { "Тип": "Поло", "Материал": "Хлопок" },
        }],
      }],
    }, [target]);

    expect(result).toMatchObject({
      target,
      category: { name: "Поло", path: target.categoryPathRu },
      competitors: [{
        sku: "123",
        title: "Поло из хлопка",
        priceRub: 1499,
        attributes: { "Тип": "Поло", "Материал": "Хлопок" },
        reviews: [],
      }],
      warnings: ["已过滤 2 个详情类型不匹配的商品"],
    });
    expect(result?.benchmarks?.content.attributePatterns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Материал" })]),
    );
  });

  const processTest = process.env.RUN_OZON_CRAWLER_PROCESS_TEST === "true" ? it : it.skip;
  processTest("starts the Python crawler and parses its JSON response", async () => {
    const [result] = await crawlOzonCompetitorsWithProcess({
      requestId: "local-process-check",
      targets: [target],
      ownSkus: new Set(["999"]),
      limitPerCategory: 1,
    });

    expect(result?.competitors.length).toBeGreaterThan(0);
  }, 300_000);
});
