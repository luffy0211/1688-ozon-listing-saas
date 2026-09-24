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
  imageUrl: "https://ir.ozone.ru/s3/multimedia-own.jpg",
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
        ozonQuery: "Поло мужские",
        ozonCategoryUrl: "/category/futbolki-i-polo-muzhskie-7558/?sorting=rating&text=%D0%9F%D0%BE%D0%BB%D0%BE%20%D0%BC%D1%83%D0%B6%D1%81%D0%BA%D0%B8%D0%B5",
      }],
      excludeSkus: ["999"],
    });
  });

  it("infers menswear from the representative title when the category path is generic", () => {
    const job = buildOzonCrawlerJob({
      requestId: "run-title-gender",
      targets: [{
        ...target,
        title: "Мужское поло с коротким рукавом",
        categoryPathRu: ["Одежда", "Одежда", "Поло"],
      }],
      ownSkus: new Set(["999"]),
      topN: 5,
      scanPages: 2,
    });

    expect(job.categories[0]).toMatchObject({
      gender: "Мужской",
      ageGroup: "Взрослые",
      ozonQuery: "Поло мужские",
      ozonCategoryUrl: "/category/futbolki-i-polo-muzhskie-7558/?sorting=rating&text=%D0%9F%D0%BE%D0%BB%D0%BE%20%D0%BC%D1%83%D0%B6%D1%81%D0%BA%D0%B8%D0%B5",
    });
  });

  it("uses known Ozon type ids when the category tree lookup failed", () => {
    const job = buildOzonCrawlerJob({
      requestId: "run-type-fallback",
      targets: [{
        ...target,
        title: "Мужское поло с коротким рукавом",
        categoryNameRu: null,
        categoryPathRu: [],
      }],
      ownSkus: new Set(),
      topN: 5,
      scanPages: 2,
    });

    expect(job.categories[0]).toMatchObject({
      categoryNameRu: "Поло",
      productType: "Поло",
      gender: "Мужской",
      ozonCategoryUrl: "/category/futbolki-i-polo-muzhskie-7558/?sorting=rating&text=%D0%9F%D0%BE%D0%BB%D0%BE%20%D0%BC%D1%83%D0%B6%D1%81%D0%BA%D0%B8%D0%B5",
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
        filteredDemographicCount: 1,
        missingDemographicCount: 4,
        deduplicatedVariantCount: 3,
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
          imageUrls: ["https://cdn.test/polo.jpg"],
          attributes: { "Тип": "Поло", "Материал": "Хлопок" },
        }],
      }],
    }, [target]);

    expect(result).toMatchObject({
      target,
      category: { name: "Поло", path: target.categoryPathRu },
      ownProduct: { imageUrls: ["https://ir.ozone.ru/s3/multimedia-own.jpg"] },
      competitors: [{
        sku: "123",
        title: "Поло из хлопка",
        priceRub: 1499,
        imageUrls: ["https://cdn.test/polo.jpg"],
        attributes: { "Тип": "Поло", "Материал": "Хлопок" },
        reviews: [],
      }],
      warnings: [
        "已过滤 2 个详情类型不匹配的商品",
        "已过滤 1 个性别或年龄不匹配的商品",
        "有 4 个商品缺少性别属性，已按标题和类目保留，建议人工复核",
        "已合并 3 个重复商品变体",
      ],
    });
    expect(result?.benchmarks?.content.attributePatterns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Материал" })]),
    );
  });

  it("drops crawler error pages before building benchmarks", () => {
    const [result] = parseOzonCrawlerOutput({
      requestId: "run-1",
      capturedAt: "2026-09-10T00:00:00Z",
      rankingType: "public_popularity_proxy",
      categories: [{
        categoryKey: "200000933:93194",
        scannedCount: 2,
        eligibleCount: 2,
        filteredMismatchedCount: 0,
        filteredInvalidEvidenceCount: 0,
        warnings: [],
        competitors: [
          {
            publicRank: 1,
            sku: "bad",
            url: "https://www.ozon.ru/product/bad/",
            title: "warning Похоже",
            description: null,
            priceRub: null,
            rating: null,
            reviewCount: null,
            sellerName: null,
            attributes: { "Image 1": "нет соединения\nВыключите VPN\nИнцидент: test" },
          },
          {
            publicRank: 2,
            sku: "good",
            url: "https://www.ozon.ru/product/good/",
            title: "Поло мужское",
            description: "Мужское поло.",
            priceRub: 1000,
            rating: 4.9,
            reviewCount: 100,
            sellerName: null,
            attributes: { Тип: "Поло", Материал: "Хлопок" },
          },
        ],
      }],
    }, [target]);

    expect(result?.competitors.map((item) => item.sku)).toEqual(["good"]);
    expect(result?.warnings).toContain("已过滤 1 个无效竞品详情页");
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
