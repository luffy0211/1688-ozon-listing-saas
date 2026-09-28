import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(), runner: vi.fn(), snapshot: vi.fn(), analyze: vi.fn(), diagnose: vi.fn(), consume: vi.fn(), refund: vi.fn(), info: vi.fn(),
  prisma: {
    agentSession: { update: vi.fn() },
    agentRun: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    agentMessage: { findMany: vi.fn(), create: vi.fn() },
    competitorContentReport: { findMany: vi.fn() }, agentAction: { findMany: vi.fn() }, $transaction: vi.fn(),
    store: { findFirst: vi.fn() },
  },
}));
vi.mock("@saas/db", async (original) => ({ ...await original<object>(), prisma: mocks.prisma, decryptSecret: () => "test-only" }));
vi.mock("@saas/ozon", async (original) => ({ ...await original<object>(), OzonClient: class {
  getProductInfoList = mocks.info;
  getProductInfoAttributes = async () => [];
  getProductStocks = async () => [];
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

import { runOzonContentAgent } from "./content-agent";

const run = (prompt: string) => runOzonContentAgent({ tenantId: "tenant", userId: "user", storeId: "store", prompt });

beforeEach(() => {
  vi.resetAllMocks();
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
  mocks.info.mockResolvedValue([{ id: 123, offer_id: "SKU-123", name: "Test product", description_category_id: 10, type_id: 20 }]);
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

describe("content agent orchestration", () => {
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
