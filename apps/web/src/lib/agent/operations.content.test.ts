import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeOzonCompetitors, buildCompetitorContentDiagnosis, cachedReportForTarget } from "./operations";
import { contentAgentDataSourcesFromToolCalls, matchingCompetitorReports } from "./content-agent";
import type { ProductImageAnalysis } from "./image-vision";
import type { OzonPublicProduct } from "./ozon-public-crawler";

const mocks = vi.hoisted(() => ({
  prisma: {
    store: { findFirst: vi.fn() },
    competitorContentReport: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    competitorProduct: { upsert: vi.fn() },
    competitorProductSnapshot: { create: vi.fn() },
  },
  client: {
    getProductInfoList: vi.fn(), getProductInfoAttributes: vi.fn(), getCategoryTree: vi.fn(),
  },
  summary: vi.fn(),
  collect: vi.fn(),
  vision: vi.fn(),
  fetch: vi.fn(() => { throw new Error("Unexpected network request"); }),
}));

vi.mock("@saas/db", () => ({ prisma: mocks.prisma, decryptSecret: vi.fn(() => "test-key") }));
vi.mock("@/lib/env", () => ({ env: { apifyApiToken: "test-token" } }));
vi.mock("@saas/ozon", async (importOriginal) => ({
  ...await importOriginal<typeof import("@saas/ozon")>(),
  getOzonAnalyticsSummary: mocks.summary,
  OzonClient: class { constructor() { return mocks.client; } },
}));
vi.mock("./apify-ozon", async (importOriginal) => ({
  ...await importOriginal<typeof import("./apify-ozon")>(),
  searchOzonApifyCompetitors: mocks.collect,
}));
vi.mock("./ozon-public-crawler", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ozon-public-crawler")>(),
  crawlOzonCategoryCompetitors: mocks.fetch,
}));
vi.mock("./ozon-search-index", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ozon-search-index")>(),
  searchOzonIndexedCompetitors: mocks.fetch,
}));
vi.mock("./image-vision", () => ({ analyzeProductImagesWithVision: mocks.vision }));
vi.mock("@openai/agents", () => ({ Agent: vi.fn(), OpenAIProvider: vi.fn(), Runner: vi.fn(), tool: vi.fn() }));
vi.mock("@/lib/credits", () => ({
  CREDIT_USAGE_FEATURES: {}, consumeTenantCredits: vi.fn(), refundTenantCredits: vi.fn(),
}));
vi.mock("./actions", () => ({ createAgentActions: vi.fn() }));
vi.mock("./snapshot", () => ({ getAgentStoreSnapshot: vi.fn() }));
vi.mock("./promotions", () => ({
  getOzonPromotionCandidates: vi.fn(), listOzonPromotions: vi.fn(), preparePromotionEnrollment: vi.fn(),
}));
vi.mock("./run-progress", () => ({ clearAgentRunProgressLater: vi.fn(), setAgentRunProgress: vi.fn() }));

const product = (sku: string, overrides: Partial<OzonPublicProduct> = {}): OzonPublicProduct => ({
  sku, url: `https://www.ozon.ru/product/${sku}/`, title: "Cotton polo",
  priceRub: 1200, oldPriceRub: null, rating: 4.8, reviewCount: 32, sellerName: "Seller",
  imageUrls: [`https://ir.ozone.ru/s3/${sku}.jpg`], attributes: {},
  description: "Cotton polo for everyday wear", reviews: [], ...overrides,
});
const report = (overrides: Record<string, unknown> = {}) => ({
  storeId: "store-1",
  target: { offerId: "offer-1", title: "Polo", descriptionCategoryId: 10, typeId: 20 },
  category: { name: "Polo", url: "https://www.ozon.ru/search/?text=polo" },
  capturedAt: "2026-09-01T00:00:00.000Z",
  ownProduct: product("own"), competitors: [product("123")], ...overrides,
});
const analysis = (label: string, imageUrl: string): ProductImageAnalysis => ({
  label, imageUrl, imageType: "product", backgroundType: "white", clarity: "high",
  hasWatermark: false, hasTextOverlay: false, productProminence: "strong",
  mainImageScore: 80, recommendationZh: "Keep this image",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.vision.mockResolvedValue({ enabled: false, model: "", analyses: [], warning: "disabled" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

describe("inline competitor content data", () => {
  it("preserves summary fields while exposing full descriptions and every competitor", async () => {
    const description = `  Cotton\n${"polo ".repeat(50)}end  `;
    const competitors = Array.from({ length: 8 }, (_, index) => product(String(index), {
      description, priceRub: 1000 + index * 100, categoryPosition: index + 1,
    }));
    const input = report({ ownProduct: product("own", { description }), competitors });
    const before = structuredClone(input);
    const result = await buildCompetitorContentDiagnosis([input]);
    const sample = result.samples[0]!;
    expect(sample).toMatchObject({
      storeId: "store-1", offerId: "offer-1", descriptionCategoryId: 10, typeId: 20,
      capturedAt: input.capturedAt, categoryName: "Polo",
      comparison: { price: { ownRub: 1200, competitorMedianRub: 1350 } },
    });
    expect(sample.competitors.map((item) => item.sku)).toEqual(competitors.map((item) => item.sku));
    for (const item of [sample.own, ...sample.competitors]) {
      expect(item).toMatchObject({
        description: description.replace(/\s+/g, " ").trim().slice(0, 180),
        fullDescription: description, descriptionIsSummary: true,
      });
    }
    expect(sample.comparison.description.samples).toHaveLength(3);
    expect(input).toEqual(before);
  });

  it("extracts per-product terms from full text without presenting them as official tags", async () => {
    const result = await buildCompetitorContentDiagnosis([report({
      ownProduct: product("own", { title: "Cotton COTTON polo 1234", description: "cotton linen" }),
      competitors: [product("123", {
        title: "Denim denim", description: "denim ".repeat(40) + "pocket",
        attributes: { OfficialTag: "not-a-keyword" },
      })],
    })]);
    expect(result.samples[0]!.own).toMatchObject({
      extractedKeywords: [{ term: "cotton", count: 3 }, { term: "linen", count: 1 }, { term: "polo", count: 1 }],
      keywordsAreOfficialTags: false,
    });
    expect(result.samples[0]!.competitors[0]).toMatchObject({
      extractedKeywords: [{ term: "denim", count: 42 }, { term: "pocket", count: 1 }],
      keywordsAreOfficialTags: false,
    });
    expect(result.samples[0]!.competitors[0]!.description).not.toContain("pocket");
    expect(result.samples[0]!.own).not.toHaveProperty("tags");
    expect(result.samples[0]!.competitors[0]).not.toHaveProperty("tags");
  });

  it.each(["missing", "read_failed", "not_read"])("preserves %s own read states and null descriptions", async (state) => {
    const result = await buildCompetitorContentDiagnosis([report({
      target: { offerId: "offer-1", title: "Polo", descriptionReadState: state, imageReadState: state },
      ownProduct: product("own", { description: null, imageUrls: [] }),
      competitors: [product("123", { description: null, imageUrls: [] })],
    })]);
    const sample = result.samples[0]!;
    expect(sample.comparison.description).toMatchObject({ ownReadState: state, ownAvailable: false });
    expect(sample.comparison.mainImage.ownReadState).toBe(state);
    for (const item of [sample.own, ...sample.competitors]) {
      expect(item).toMatchObject({ description: null, fullDescription: null, descriptionIsSummary: true, imageAnalysis: null });
    }
  });

  it("keeps unknown own content unknown instead of using competitor content", async () => {
    const result = await buildCompetitorContentDiagnosis([report({ ownProduct: null })]);
    expect(result.samples[0]!.own).toMatchObject({
      title: "Polo", description: null, fullDescription: null, descriptionIsSummary: true,
      extractedKeywords: [{ term: "polo", count: 1 }], keywordsAreOfficialTags: false,
    });
    expect(result.samples[0]!.comparison.description.ownReadState).toBe("not_read");
  });

  it("uses each report's own store identity, never target IDs, sellers or another report", async () => {
    const result = await buildCompetitorContentDiagnosis([
      report(), report({ storeId: "store-2" }),
      report({ storeId: undefined, target: { storeId: "target-store", offerId: "offer-1" } }),
      report({ storeId: 42 }), report({ storeId: "   " }),
    ]);
    expect(result.samples.map((sample) => sample.storeId)).toEqual(["store-1", "store-2", null, null, null]);
    const [source] = contentAgentDataSourcesFromToolCalls([{
      name: "analyze_ozon_competitors", at: "2026-09-01T00:00:00.000Z",
      output: { storeId: "source-store-must-not-fill-missing-identities", contentDiagnosis: result },
    }]);
    expect(source!.contentDiagnosis).toBe(result);
  });

  it("retains the report store when cached evidence is retargeted", async () => {
    const cached = cachedReportForTarget(report(), {
      offerId: "current", title: "Current polo", publicSku: "current-sku", quantity: 0, revenueRub: 0,
    });
    const result = await buildCompetitorContentDiagnosis([cached]);
    expect(result.samples[0]).toMatchObject({ storeId: "store-1", offerId: "current", own: { title: "Current polo" } });
  });

  it("does not invent competitor sales from popularity metrics or unverified source fields", async () => {
    const competitor = { ...product("123"), sales: 100, salesCount: 100, quantity: 100, revenueRub: 1000 };
    const result = await buildCompetitorContentDiagnosis([report({ competitors: [competitor] })]);
    expect(result.heatProxyNotice).toContain("真实销量");
    expect(result.samples[0]!.comparison.heat).toMatchObject({ competitorMedianReviewCount: 32, competitorMedianRating: 4.8 });
    for (const key of ["sales", "salesCount", "quantity", "revenueRub"]) {
      expect(result.samples[0]!.competitors[0]).not.toHaveProperty(key);
    }
  });

  it("binds vision only to matching images in the original first-sample budget", async () => {
    const competitors = Array.from({ length: 8 }, (_, index) => product(String(index)));
    const ownAnalysis = analysis("自家 offer-1", product("own").imageUrls[0]!);
    const competitorAnalysis = analysis("竞品1", competitors[0]!.imageUrls[0]!);
    const vision = { enabled: true, model: "mock", warning: null, analyses: [
      competitorAnalysis, ownAnalysis,
      analysis("竞品2", competitors[7]!.imageUrls[0]!),
      analysis("wrong label", competitors[2]!.imageUrls[0]!),
      analysis("竞品4", competitors[3]!.imageUrls[0]!),
    ] };
    mocks.vision.mockResolvedValue(vision);
    const input = report({ competitors });
    const result = await buildCompetitorContentDiagnosis([input, { ...input, storeId: "store-2" }]);
    expect(mocks.vision).toHaveBeenCalledExactlyOnceWith([
      { label: "自家 offer-1", imageUrl: product("own").imageUrls[0] },
      ...competitors.slice(0, 3).map((item, index) => ({ label: `竞品${index + 1}`, imageUrl: item.imageUrls[0] })),
    ]);
    expect(result.vision).toEqual(vision);
    expect(result.samples[0]!.own.imageAnalysis).toEqual(ownAnalysis);
    expect(result.samples[0]!.competitors.map((item) => item.imageAnalysis)).toEqual([
      competitorAnalysis, null, null, null, null, null, null, null,
    ]);
    expect(result.samples[1]!.own.imageAnalysis).toBeNull();
    expect(result.samples[1]!.competitors.every((item) => item.imageAnalysis === null)).toBe(true);
  });

  it("does not attach an unsolicited analysis when the submitted image was absent", async () => {
    mocks.vision.mockResolvedValue({ enabled: true, model: "mock", warning: null,
      analyses: [analysis("自家 offer-1", product("own").imageUrls[0]!)],
    });
    const result = await buildCompetitorContentDiagnosis([report({ ownProduct: product("own", { imageUrls: [] }) })]);
    expect(result.samples[0]!.own.imageAnalysis).toBeNull();
  });

  it("does not invoke vision when no valid competitor sample exists", async () => {
    const result = await buildCompetitorContentDiagnosis([null, report({ competitors: [] }), report({ competitors: [{}] })]);
    expect(result.samples).toEqual([]);
    expect(mocks.vision).not.toHaveBeenCalled();
    expect(result.vision.analyses).toEqual([]);
  });
});

describe("report identity propagation (all services mocked)", () => {
  it.each(["fresh", "failed", "cached"])("preserves resolved store identity through %s reports and source output", async (mode) => {
    const usable = mode !== "failed";
    mocks.prisma.store.findFirst.mockResolvedValue({
      id: "resolved-store", name: "Store", ozonClientId: "client", ozonApiKey: "encrypted",
    });
    mocks.summary.mockResolvedValue({ topProducts: [], products: [{
      offerId: "offer-1", name: "Polo", publicSku: "own", descriptionCategoryId: 10, typeId: 20,
      visible: true, archived: false, stock: 1,
    }] });
    mocks.client.getProductInfoList.mockResolvedValue([]);
    mocks.client.getProductInfoAttributes.mockResolvedValue([]);
    mocks.client.getCategoryTree.mockResolvedValue([{
      description_category_id: 10, category_name: "Clothes", children: [{ type_id: 20, type_name: "Polo" }],
    }]);
    const cachedReport = report({
      storeId: "resolved-store", source: "apify_ozon_scraper",
      detailScope: "category_search_index_attributes_description_v3", competitorsPerCategory: 3,
      target: { offerId: "historical-offer", title: "Historical polo", descriptionCategoryId: 10, typeId: 20 },
    });
    mocks.prisma.competitorContentReport.findMany.mockResolvedValue(mode === "cached" ? [
      { reportJson: { ...cachedReport, storeId: "foreign-store" } },
      { reportJson: cachedReport },
    ] : []);
    mocks.prisma.competitorContentReport.findFirst.mockResolvedValue(null);
    mocks.prisma.competitorContentReport.create.mockResolvedValue({ id: "report-1" });
    mocks.prisma.competitorProduct.upsert.mockResolvedValue({ id: "competitor-1" });
    mocks.prisma.competitorProductSnapshot.create.mockResolvedValue({ id: "snapshot-1" });
    mocks.collect.mockImplementation(async ({ targets }) => [{
      ...report(), storeId: "untrusted-provider-store", target: targets[0],
      competitors: usable ? [product("123")] : [],
      collectionState: usable ? "partial" : "provider_failed", warnings: [], benchmarks: null,
    }]);
    const result = await analyzeOzonCompetitors({
      tenantId: "tenant-1", userId: "user-1", competitorsPerCategory: 3,
      onBillableCategories: vi.fn().mockResolvedValue(undefined),
      onFailedCategories: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.store.id).toBe("resolved-store");
    expect(result.reports[0]).toMatchObject({ storeId: "resolved-store" });
    if (usable) {
      expect(result.contentDiagnosis.samples[0]).toMatchObject({ storeId: "resolved-store", offerId: "offer-1" });
      if (mode === "fresh") {
        expect(mocks.prisma.competitorContentReport.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ reportJson: expect.objectContaining({ storeId: "resolved-store" }) }),
        }));
      } else {
        expect(mocks.collect).not.toHaveBeenCalled();
        expect(result.reports[0]).toMatchObject({ cached: true, target: { offerId: "offer-1" } });
      }
    } else {
      expect(result.contentDiagnosis.samples).toEqual([]);
    }

    const focusedProduct = { storeId: "resolved-store", offerId: "different-offer-in-same-category",
      rawInfo: { description_category_id: 10, type_id: 20 },
    };
    const focusedReports = matchingCompetitorReports(focusedProduct, result.reports);
    const focusedOfferIds = new Set(focusedReports.map((item) => (item as { target: { offerId: string } }).target.offerId));
    const focusedDiagnosis = { ...result.contentDiagnosis,
      samples: result.contentDiagnosis.samples.filter((sample) => focusedOfferIds.has(sample.offerId!)),
    };
    const [source] = contentAgentDataSourcesFromToolCalls([{
      name: "analyze_ozon_competitors", at: result.capturedAt,
      output: { storeId: result.store.id, contentDiagnosis: focusedDiagnosis },
    }]);
    expect(source!.contentDiagnosis).toBe(focusedDiagnosis);
    const serialized = JSON.parse(JSON.stringify(source!.contentDiagnosis)) as typeof focusedDiagnosis;
    expect(serialized.samples).toHaveLength(usable ? 1 : 0);
    if (usable) {
      expect(serialized.samples[0]).toMatchObject({
        storeId: "resolved-store", offerId: "offer-1",
        competitors: [{ fullDescription: product("123").description, descriptionIsSummary: true,
          extractedKeywords: expect.arrayContaining([{ term: "cotton", count: 2 }]),
        }],
      });
    }
  });
});
