import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(), runner: vi.fn(), snapshot: vi.fn(), analyze: vi.fn(), diagnose: vi.fn(), consume: vi.fn(), refund: vi.fn(), info: vi.fn(),
  attributes: vi.fn(), stocks: vi.fn(), fetch: vi.fn(() => { throw new Error("Unexpected network request"); }),
  prisma: {
    agentSession: { update: vi.fn() },
    agentRun: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    agentMessage: { findMany: vi.fn(), create: vi.fn() },
    competitorContentReport: { findMany: vi.fn() }, agentAction: { findMany: vi.fn() }, $transaction: vi.fn(),
    store: { findFirst: vi.fn() },
  },
}));
vi.mock("@saas/db", () => ({
  prisma: mocks.prisma, decryptSecret: () => "test-only", Prisma: {},
  AgentActionType: { CONTENT_DRAFT: "CONTENT_DRAFT", PROMOTION_POLICY: "PROMOTION_POLICY", PROMOTION_ENROLLMENT: "PROMOTION_ENROLLMENT" },
  AgentRiskLevel: { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
  AgentRunStatus: { RUNNING: "RUNNING", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED" },
}));
vi.mock("@saas/ozon", async (original) => ({ ...await original<object>(), OzonClient: class {
  getProductInfoList = mocks.info;
  getProductInfoAttributes = mocks.attributes;
  getProductStocks = mocks.stocks;
} }));
vi.mock("./content-agent-prepare", () => ({ beginContentAgentRun: mocks.begin }));
vi.mock("@/lib/env", () => ({ env: { openaiApiKey: "test-only", openaiAgentModel: "test-model", openaiAgentMock: false } }));
vi.mock("@openai/agents", () => ({
  Agent: class { constructor(public config: unknown) {} },
  Runner: class { run = mocks.runner; }, OpenAIProvider: class {}, tool: (config: unknown) => config,
}));
vi.mock("./snapshot", () => ({ getAgentStoreSnapshot: mocks.snapshot }));
vi.mock("./operations", async (original) => ({ ...await original<object>(), analyzeOzonCompetitors: mocks.analyze, diagnoseOzonStore: mocks.diagnose }));
vi.mock("@/lib/credits", async (original) => ({
  ...await original<object>(), consumeTenantCredits: mocks.consume, refundTenantCredits: mocks.refund,
}));
vi.mock("./run-progress", () => ({ setAgentRunProgress: vi.fn(), clearAgentRunProgressLater: vi.fn() }));
vi.mock("./actions", () => ({ createAgentActions: vi.fn() }));
vi.mock("./promotions", () => ({
  getOzonPromotionCandidates: vi.fn(), listOzonPromotions: vi.fn(), preparePromotionEnrollment: vi.fn(),
}));

import { runOzonContentAgent } from "./content-agent";

const run = (prompt: string) => runOzonContentAgent({ tenantId: "tenant", userId: "user", storeId: "store", prompt });
const productInfo = { id: 123, offer_id: "SKU-123", name: "Test product", description_category_id: 10, type_id: 20 };
const refreshPrompt = "仅重新采集并分析竞品，限当前店铺的 Polo 类目，参考自家商品 SKU-123，采集 8 个竞品。其他类目继续复用已有数据。";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.begin.mockImplementation(async ({ prompt }) => ({
    session: { id: "session" }, userMessage: { id: "message" }, runRecord: { id: "run" }, prompt, storeId: "store",
  }));
  mocks.prisma.agentRun.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.agentMessage.findMany.mockResolvedValue([]);
  mocks.prisma.agentRun.findFirst.mockResolvedValue(null);
  mocks.prisma.competitorContentReport.findMany.mockResolvedValue([]);
  mocks.prisma.agentAction.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(async (operations) => Promise.all(operations));
  mocks.runner.mockResolvedValue({ finalOutput: "已完成检查，没有修改商品。" });
  mocks.consume.mockResolvedValue({});
  mocks.refund.mockResolvedValue({});
  mocks.prisma.store.findFirst.mockResolvedValue({ id: "store", name: "Test", ozonClientId: "client", ozonApiKey: "test-only" });
  mocks.info.mockResolvedValue([productInfo]);
  mocks.attributes.mockResolvedValue([]);
  mocks.stocks.mockResolvedValue([]);
  mocks.analyze.mockImplementation(async ({ onBillableCategories }) => {
    await onBillableCategories(1);
    return {
      store: { id: "store", name: "Test" }, reports: [], categoryPlaybooks: [], productRecommendations: [],
      contentDiagnosis: { samples: [] }, evidenceQuality: {}, warnings: [], competitorsPerCategory: 1,
    };
  });
  mocks.diagnose.mockResolvedValue({
    store: { id: "store", name: "Test" }, current30d: {}, previous30d: {}, productInvestigation: { evidence: [] },
    lowStockProducts: [], lowContentRatingProducts: [{ offerId: "SKU-123", contentRating: 20, visible: true, stock: 1, recommendations: [] }],
    issues: [], warnings: [], contentRatingDataAvailable: true,
  });
  mocks.snapshot.mockResolvedValue({
    store: { id: "store", name: "Test" }, stores: [], latestSnapshot: null,
    guardrails: {}, pricingRule: null, products: [], compiledDrafts: [],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

describe("content agent orchestration", () => {
  it("reads an explicit refresh product before scoping collection and billing", async () => {
    await run(refreshPrompt);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith({ offerIds: ["SKU-123"] });
    expect(mocks.prisma.store.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant", id: "store" },
    }));
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      storeId: "store", targetCategory: { descriptionCategoryId: 10, typeId: 20 },
      refreshEvidence: true, competitorsPerCategory: 8,
    }));
    expect(mocks.info.mock.invocationCallOrder[0]).toBeLessThan(mocks.analyze.mock.invocationCallOrder[0]!);
    expect(mocks.analyze.mock.invocationCallOrder[0]).toBeLessThan(mocks.consume.mock.invocationCallOrder[0]!);
  });

  it.each([
    { name: "not found", products: [], error: "指定自家商品读取失败或货号不匹配" },
    { name: "missing category", products: [{ ...productInfo, description_category_id: null }], error: "完整官方类目" },
    { name: "invalid type", products: [{ ...productInfo, type_id: 0 }], error: "完整官方类目" },
    { name: "another offer", products: [{ ...productInfo, offer_id: "OTHER" }], error: "指定自家商品读取失败或货号不匹配" },
  ])("fails before collection or billing when the explicit product is $name", async ({ products, error }) => {
    mocks.info.mockResolvedValue(products);
    await expect(run(refreshPrompt)).rejects.toThrow(error);
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.runner).not.toHaveBeenCalled();
  });

  it("fails before billing when the explicit product read fails", async () => {
    mocks.info.mockRejectedValue(new Error("Seller API unavailable"));
    mocks.attributes.mockRejectedValue(new Error("Seller API unavailable"));
    await expect(run(refreshPrompt)).rejects.toThrow("指定自家商品读取失败或货号不匹配");
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("uses existing store-scope validation before any collection or billing", async () => {
    mocks.prisma.store.findFirst.mockResolvedValue({ id: "other-store", ozonClientId: "client", ozonApiKey: "test-only" });
    await expect(run(refreshPrompt)).rejects.toThrow("store_scope_mismatch");
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("pins a default-store refresh to the store resolved by the product read", async () => {
    mocks.begin.mockImplementation(async ({ prompt }) => ({
      session: { id: "session" }, userMessage: { id: "message" }, runRecord: { id: "run" }, prompt, storeId: null,
    }));
    await runOzonContentAgent({ tenantId: "tenant", userId: "user", prompt: refreshPrompt });
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      storeId: "store", targetCategory: { descriptionCategoryId: 10, typeId: 20 },
    }));
  });

  it("reuses an explicit product already read by the content workflow", async () => {
    await run("优化自家商品 SKU-123 的标题");
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.attributes).toHaveBeenCalledTimes(1);
    expect(mocks.stocks).toHaveBeenCalledTimes(1);
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      targetCategory: { descriptionCategoryId: 10, typeId: 20 }, refreshEvidence: false,
    }));
  });

  it("keeps diagnosis-led category analysis working without an explicit offer", async () => {
    await run("优化店铺内容");
    expect(mocks.diagnose).toHaveBeenCalledTimes(1);
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      targetCategory: { descriptionCategoryId: 10, typeId: 20 },
    }));
  });

  it("can scope by real attribute data even when detail and stock reads fail", async () => {
    mocks.info.mockRejectedValue(new Error("Details unavailable"));
    mocks.stocks.mockRejectedValue(new Error("Stock unavailable"));
    mocks.attributes.mockResolvedValue([productInfo]);
    await run(refreshPrompt);
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      targetCategory: { descriptionCategoryId: 10, typeId: 20 },
    }));
  });

  it.each(["优化店铺内容，不要分析竞品", "优化 SKU-123 的标题，不要分析竞品"])("honors competitor opt-out during preload: %s", async (prompt) => {
    await run(prompt);
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.prisma.agentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }));
  });
  it("keeps inventory-only runs read-only unless an approved mutation is separately proposed", async () => {
    await run("查看店铺库存，不要优化内容，不要分析竞品");
    expect(mocks.snapshot).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant", storeId: "store" }));
    expect(mocks.analyze).not.toHaveBeenCalled();
    const config = mocks.runner.mock.calls[0]![0].config;
    const names = config.tools.map((item: { name: string }) => item.name);
    expect(names).not.toContain("analyze_ozon_competitors");
    expect(names).not.toContain("propose_content_draft");
    expect(mocks.prisma.agentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }));
  });

  it("charges categories once and refunds only the empty category", async () => {
    mocks.analyze.mockImplementation(async ({ onBillableCategories, onFailedCategories }) => {
      await onBillableCategories(2);
      await onFailedCategories(1);
      return {
        store: { id: "store", name: "Test" }, reports: [], categoryPlaybooks: [], productRecommendations: [],
        contentDiagnosis: { samples: [] }, evidenceQuality: {}, warnings: [], competitorsPerCategory: 1,
      };
    });
    await run("分析店铺同类竞品价格，每类一个");
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ targetCategory: null }));
    expect(mocks.consume).toHaveBeenCalledTimes(1);
    expect(mocks.consume).toHaveBeenCalledWith(expect.objectContaining({ feature: "competitor_analysis", amount: 100 }));
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 50, tenantId: "tenant" }));
  });

  it("refunds the category debit when the provider fails", async () => {
    mocks.analyze.mockImplementation(async ({ onBillableCategories }) => {
      await onBillableCategories(2);
      throw new Error("provider unavailable");
    });
    await expect(run("分析店铺同类竞品，每类一个")).rejects.toThrow("provider unavailable");
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
    expect(mocks.prisma.agentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });
});
