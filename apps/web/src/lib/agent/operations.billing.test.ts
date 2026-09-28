import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeOzonCompetitors } from "./operations";
import { parseApifyOzonProduct } from "./apify-ozon";

const mocks = vi.hoisted(() => ({
  prisma: {
    store: { findFirst: vi.fn() },
    competitorContentReport: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    competitorProduct: { upsert: vi.fn() },
    competitorProductSnapshot: { create: vi.fn() },
  },
  summary: vi.fn(),
  client: {
    getProductInfoList: vi.fn(), getProductInfoAttributes: vi.fn(), getCategoryTree: vi.fn(),
    getCategoryAttributes: vi.fn(),
  },
  env: { apifyApiToken: "test-token" },
  fetch: vi.fn(),
}));

vi.mock("@saas/db", () => ({ prisma: mocks.prisma, decryptSecret: () => "test-key" }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("@saas/ozon", async (importOriginal) => ({
  ...await importOriginal<typeof import("@saas/ozon")>(),
  getOzonAnalyticsSummary: mocks.summary,
  OzonClient: class { constructor() { return mocks.client; } },
}));

const product = (typeId: number) => ({
  offerId: `own-${typeId}`, productId: String(typeId), name: "Polo", publicSku: `own-${typeId}`,
  descriptionCategoryId: 10, typeId, visible: true, archived: false, stock: 1,
});
const item = {
  sku: "123", url: "https://www.ozon.ru/product/polo-123/", title: "Polo",
  characteristics: [{ name: "Тип", value: "Поло" }], richDescription: "Cotton polo",
};
const params = () => ({
  tenantId: "tenant-1", userId: "user-1", storeId: "store-1", competitorsPerCategory: 3,
  onBillableCategories: vi.fn().mockResolvedValue(undefined),
  onFailedCategories: vi.fn().mockResolvedValue(undefined),
});

function cache(typeId: number, storeId = "store-1") {
  const competitor = parseApifyOzonProduct(item, 1)!;
  return { reportJson: {
    storeId, source: "apify_ozon_scraper", detailScope: "category_search_index_attributes_description_v3",
    target: { ...product(typeId), title: "Polo", categoryNameRu: "Поло" },
    category: { name: "Поло", url: "https://www.ozon.ru/search/?text=polo" },
    ownProduct: { ...competitor, sku: "own" }, competitors: [competitor], competitorsPerCategory: 3,
  } };
}

describe("competitor category billing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.env.apifyApiToken = "test-token";
    mocks.prisma.store.findFirst.mockResolvedValue({
      id: "store-1", name: "Store", ozonClientId: "client-1", ozonApiKey: "encrypted",
    });
    mocks.summary.mockResolvedValue({ products: [product(20), product(21)], topProducts: [], warnings: [] });
    mocks.client.getProductInfoList.mockResolvedValue([]);
    mocks.client.getProductInfoAttributes.mockResolvedValue([]);
    mocks.client.getCategoryTree.mockResolvedValue([{
      description_category_id: 10, category_name: "Clothes",
      children: [20, 21].map((type_id) => ({ type_id, type_name: "Поло" })),
    }]);
    mocks.client.getCategoryAttributes.mockResolvedValue([]);
    mocks.prisma.competitorContentReport.findMany.mockResolvedValue([]);
    mocks.prisma.competitorContentReport.findFirst.mockResolvedValue(null);
    mocks.prisma.competitorContentReport.create.mockResolvedValue({ id: "report-1" });
    mocks.prisma.competitorProduct.upsert.mockResolvedValue({ id: "competitor-1" });
    mocks.prisma.competitorProductSnapshot.create.mockResolvedValue({ id: "snapshot-1" });
    mocks.fetch.mockImplementation(async () => new Response("[]"));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("precharges once and refunds only the failed category while preserving partial usable evidence", async () => {
    const input = params();
    mocks.fetch.mockImplementationOnce(async () => {
      expect(input.onBillableCategories).toHaveBeenCalledExactlyOnceWith(2);
      return new Response(JSON.stringify([item]));
    }).mockRejectedValueOnce(new Error("timeout"));
    const result = await analyzeOzonCompetitors(input);
    expect(input.onFailedCategories).toHaveBeenCalledExactlyOnceWith(1);
    expect(result.reports).toMatchObject([
      { collectionState: "partial", competitors: [{ sku: "123" }] },
      { collectionState: "provider_failed", competitors: [] },
    ]);
    expect(mocks.prisma.competitorProduct.upsert).toHaveBeenCalledTimes(1);
  });

  it.each(["empty", "provider failure"])("refunds every category after full %s", async (failure) => {
    const input = params();
    if (failure === "provider failure") mocks.fetch.mockRejectedValue(new Error("timeout"));
    await analyzeOzonCompetitors(input);
    expect(input.onBillableCategories).toHaveBeenCalledExactlyOnceWith(2);
    expect(input.onFailedCategories).toHaveBeenCalledExactlyOnceWith(2);
    expect(mocks.prisma.competitorProduct.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.competitorContentReport.create).not.toHaveBeenCalled();
  });

  it("preserves cache pricing and refunds only newly collected empty categories", async () => {
    const input = params();
    mocks.prisma.competitorContentReport.findMany.mockResolvedValue([cache(20)]);
    const result = await analyzeOzonCompetitors(input);
    expect(input.onBillableCategories).toHaveBeenCalledExactlyOnceWith(2);
    expect(input.onFailedCategories).toHaveBeenCalledExactlyOnceWith(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(result.reports[0]).toMatchObject({ cached: true });
    expect(mocks.prisma.competitorContentReport.findMany.mock.calls[0]![0].where.tenantId).toBe("tenant-1");
  });

  it("does not reuse another store's evidence", async () => {
    mocks.prisma.competitorContentReport.findMany.mockResolvedValue([cache(20, "other-store")]);
    const input = params();
    await analyzeOzonCompetitors(input);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(input.onFailedCategories).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("does not collect when the precharge rejects for insufficient credits", async () => {
    const input = params();
    input.onBillableCategories.mockRejectedValue(new Error("insufficient_credits"));
    await expect(analyzeOzonCompetitors(input)).rejects.toThrow("insufficient_credits");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(input.onFailedCategories).not.toHaveBeenCalled();
  });

  it.each(["onBillableCategories", "onFailedCategories"] as const)("fails closed without %s", async (missing) => {
    const input = { ...params(), [missing]: undefined };
    await expect(analyzeOzonCompetitors(input)).rejects.toThrow("competitor_billing_callbacks_required");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(input.onBillableCategories?.mock.calls ?? []).toHaveLength(0);
  });

  it("charges cache only when collection is unavailable", async () => {
    mocks.env.apifyApiToken = "";
    mocks.prisma.competitorContentReport.findMany.mockResolvedValue([cache(20)]);
    const input = params();
    await analyzeOzonCompetitors(input);
    expect(input.onBillableCategories).toHaveBeenCalledExactlyOnceWith(1);
    expect(input.onFailedCategories).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("never refunds usable categories or retries collection to fill a short sample", async () => {
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify([item])));
    const input = params();
    await analyzeOzonCompetitors(input);
    expect(input.onBillableCategories).toHaveBeenCalledExactlyOnceWith(2);
    expect(input.onFailedCategories).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.competitorContentReport.create.mock.calls).toHaveLength(2);
    expect(mocks.prisma.competitorContentReport.create.mock.calls[0]![0].data.reportJson)
      .toMatchObject({ collectionState: "partial" });
  });

  it("does not charge or refund unavailable categories", async () => {
    mocks.client.getCategoryTree.mockResolvedValue([]);
    const input = params();
    const result = await analyzeOzonCompetitors(input);
    expect(input.onBillableCategories).not.toHaveBeenCalled();
    expect(input.onFailedCategories).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(result.reports).toMatchObject([
      { collectionState: "unavailable" }, { collectionState: "unavailable" },
    ]);
  });

  it("refreshes requested evidence without also charging the old cache", async () => {
    mocks.prisma.competitorContentReport.findMany.mockResolvedValue([cache(20)]);
    const input = { ...params(), refreshEvidence: true };
    await analyzeOzonCompetitors(input);
    expect(mocks.prisma.competitorContentReport.findMany).not.toHaveBeenCalled();
    expect(input.onBillableCategories).toHaveBeenCalledExactlyOnceWith(2);
    expect(input.onFailedCategories).toHaveBeenCalledExactlyOnceWith(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("charges once for multiple own products in the same category", async () => {
    mocks.summary.mockResolvedValue({
      products: [product(20), { ...product(20), offerId: "another-own" }], topProducts: [],
    });
    const input = params();
    await analyzeOzonCompetitors(input);
    expect(input.onBillableCategories).toHaveBeenCalledExactlyOnceWith(1);
    expect(input.onFailedCategories).toHaveBeenCalledExactlyOnceWith(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("propagates refund failures instead of silently claiming settlement", async () => {
    const input = params();
    input.onFailedCategories.mockRejectedValue(new Error("refund_failed"));
    await expect(analyzeOzonCompetitors(input)).rejects.toThrow("refund_failed");
    expect(input.onFailedCategories).toHaveBeenCalledTimes(1);
  });

  it("leaves thrown persistence failures to the caller's full-refund handler", async () => {
    mocks.fetch.mockImplementationOnce(async () => new Response(JSON.stringify([item])));
    mocks.prisma.competitorProduct.upsert.mockRejectedValue(new Error("write_failed"));
    const input = params();
    await expect(analyzeOzonCompetitors(input)).rejects.toThrow("write_failed");
    expect(input.onFailedCategories).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity, 11])("rejects invalid sample count %s before any external work", async (competitorsPerCategory) => {
    const input = { ...params(), competitorsPerCategory };
    await expect(analyzeOzonCompetitors(input)).rejects.toThrow("competitor_sample_limit_invalid");
    expect(mocks.prisma.store.findFirst).not.toHaveBeenCalled();
    expect(input.onBillableCategories).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
