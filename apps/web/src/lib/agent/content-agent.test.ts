import { describe, expect, it } from "vitest";
import {
  competitorAnalysisCreditCost,
  contentDraftCategoryFromProduct,
  competitorsPerCategoryFromPrompt,
  competitorMemoryContextFromReports,
  categoryExperienceSummary,
  contentAgentModelName,
  contentAgentModelSettings,
  contentAgentDataSourcesFromToolCalls,
  buildAgentInput,
  fallbackPromotionPolicyFromPrompt,
  fallbackContentDraftSuggestion,
  matchingCompetitorReports,
  normalizeOzonProductContent,
  optionalStoreId,
  productContentForDraft,
  requiredOzonToolForPrompt,
  requiredOzonToolsForPrompt,
  shouldRunCompetitorAnalysisForDiagnosis,
  shouldRefreshCompetitorEvidence,
  shouldCreateFallbackContentDraft,
  selectContentDraftTarget,
} from "./content-agent";

describe("competitor analysis credits", () => {
  it("charges the current 50-credit unit for each own-store category", () => {
    expect(competitorAnalysisCreditCost(0)).toBe(0);
    expect(competitorAnalysisCreditCost(1)).toBe(50);
    expect(competitorAnalysisCreditCost(5)).toBe(250);
  });
});

describe("contentAgentModelSettings", () => {
  it("uses DeepSeek chat for thinking models that cannot replay reasoning_content", () => {
    expect(contentAgentModelName("https://api.deepseek.com", "deepseek-v4-flash")).toBe(
      "deepseek-chat",
    );
    expect(contentAgentModelName("https://api.deepseek.com", "deepseek-reasoner")).toBe(
      "deepseek-chat",
    );
    expect(contentAgentModelName("https://api.deepseek.com", "deepseek-chat")).toBe(
      "deepseek-chat",
    );
    expect(contentAgentModelName("https://api.openai.com/v1", "gpt-5.1")).toBe("gpt-5.1");
  });

  it("disables DeepSeek thinking for multi-turn tool compatibility", () => {
    expect(contentAgentModelSettings("https://api.deepseek.com")).toEqual({
      providerData: { thinking: { type: "disabled" } },
    });
    expect(contentAgentModelSettings("https://api.openai.com/v1")).toEqual({});
  });
});

describe("fallbackPromotionPolicyFromPrompt", () => {
  it("compiles explicit promotion rules when the model skips the tool call", () => {
    expect(
      fallbackPromotionPolicyFromPrompt(
        "活动报名规则：只适用于 offerId 前缀 POLO- 的商品，库存大于等于 1，当前价必须大于 0，活动价按当前价 9 折。",
      ),
    ).toMatchObject({
      rule: {
        all: [
          { field: "stock", operator: "gte", value: 1 },
          { field: "currentPrice", operator: "gte", value: 0.01 },
        ],
      },
      scope: { offerIdPrefixes: ["POLO-"] },
      priceRule: { mode: "multiplier", value: 0.9 },
    });
  });

  it("does not compile when no safe price rule is present", () => {
    expect(fallbackPromotionPolicyFromPrompt("只要库存足够就报名活动")).toBeNull();
  });
});

describe("normalizeOzonProductContent", () => {
  it("maps Ozon product info and stock into a content snapshot", () => {
    const product = normalizeOzonProductContent({
      store: { id: "store_1", name: "Default Ozon Store" },
      offerId: "SKU-123",
      capturedAt: "2026-08-31T00:00:00.000Z",
      info: {
        product_id: 99,
        offer_id: "SKU-123",
        name: "Женское платье летнее",
        visible: true,
        archived: false,
        status: { state_name: "Продается" },
        price: "1290",
        marketing_price: "1190",
        old_price: "1690",
        currency_code: "RUB",
        primary_image: "https://example.com/main.jpg",
        images: ["https://example.com/main.jpg", "https://example.com/2.jpg"],
      },
      stocks: [
        {
          product_id: 99,
          offer_id: "SKU-123",
          stocks: [
            { present: 5, reserved: 1, type: "fbs" },
            { present: 7, reserved: 2, type: "fbo" },
          ],
        },
      ],
    });

    expect(product).toMatchObject({
      found: true,
      storeId: "store_1",
      offerId: "SKU-123",
      productId: "99",
      name: "Женское платье летнее",
      visible: true,
      archived: false,
      status: "Продается",
      priceRub: 1290,
      marketingPriceRub: 1190,
      oldPriceRub: 1690,
      currencyCode: "RUB",
      stock: 12,
      reservedStock: 3,
      capturedAt: "2026-08-31T00:00:00.000Z",
    });
    expect(product.images).toHaveLength(2);
  });

  it("returns an explicit not-found snapshot", () => {
    const product = normalizeOzonProductContent({
      store: { id: "store_1", name: "Default Ozon Store" },
      offerId: "MISSING-1",
      stocks: [],
      capturedAt: "2026-08-31T00:00:00.000Z",
    });

    expect(product.found).toBe(false);
    expect(product.offerId).toBe("MISSING-1");
    expect(product.productId).toBeNull();
    expect(product.stock).toBeNull();
  });

  it("keeps earlier reads available when drafting after another product read", () => {
    const first = normalizeOzonProductContent({
      store: { id: "store_1", name: "Default Ozon Store" },
      offerId: "SKU-A",
      capturedAt: "2026-08-31T00:00:00.000Z",
      info: { product_id: 1, offer_id: "SKU-A", name: "Первый товар" },
      stocks: [],
    });
    const second = normalizeOzonProductContent({
      store: { id: "store_1", name: "Default Ozon Store" },
      offerId: "SKU-B",
      capturedAt: "2026-08-31T00:01:00.000Z",
      info: { product_id: 2, offer_id: "SKU-B", name: "Второй товар" },
      stocks: [],
    });

    const readProducts = new Map([
      [first.offerId, first],
      [second.offerId, second],
    ]);

    expect(productContentForDraft(readProducts, "SKU-A")).toBe(first);
  });
});

describe("content agent tool enforcement helpers", () => {
  it("treats string null store ids as unspecified", () => {
    expect(optionalStoreId("null")).toBeNull();
    expect(optionalStoreId(" undefined ")).toBeNull();
    expect(optionalStoreId("store-1")).toBe("store-1");
  });

  it("builds a conservative fallback draft suggestion", () => {
    const suggestion = fallbackContentDraftSuggestion({
      offerId: "F18260807vo-0A-XL",
      name: "Мужское летнее поло с абстрактно-геометрическим принтом, облегающего кроя",
    });

    expect(suggestion).not.toBeNull();
    if (!suggestion) throw new Error("expected fallback suggestion");
    expect(suggestion.field).toBe("title");
    expect(suggestion.current).toContain("облегающего кроя");
    expect(suggestion.suggestedRu).toContain("облегающий крой");
    expect(suggestion.sourceTag).toBe("自家信息优化");
  });

  it("does not create a fallback draft when the title would stay unchanged", () => {
    expect(fallbackContentDraftSuggestion({
      offerId: "SKU-UNCHANGED",
      name: "Мужское классическое поло",
    })).toBeNull();
  });

  it("builds model context from the newest messages in chronological order", () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `message-${index + 1}`,
    }));

    const input = buildAgentInput("latest-request", history, "store-context");

    expect(input).toContain("message-1");
    expect(input).toContain("message-8");
    expect(input).not.toContain("message-9");
    expect(input.indexOf("message-8")).toBeLessThan(input.indexOf("message-1"));
  });

  it("refreshes Tavily evidence only when the user explicitly requests it", () => {
    expect(shouldRefreshCompetitorEvidence("使用之前采集的信息做全店诊断")).toBe(false);
    expect(shouldRefreshCompetitorEvidence("重新采集竞品，每个类目5个")).toBe(true);
    expect(shouldRefreshCompetitorEvidence("刷新竞品数据，每个类目5个")).toBe(true);
    expect(shouldRefreshCompetitorEvidence("内容优化使用一周前的竞品")).toBe(false);
    expect(shouldRefreshCompetitorEvidence("重新采集竞品分析，每个类目 1 个")).toBe(true);
    expect(requiredOzonToolForPrompt("重新采集竞品分析，每个类目 1 个", null))
      .toBe("analyze_ozon_competitors");
  });

  it("uses only competitor reports from the product's exact Ozon category", () => {
    const reports = [
      { target: { descriptionCategoryId: 10, typeId: 20 }, competitors: [{ sku: "MATCH" }] },
      { target: { descriptionCategoryId: 10, typeId: 21 }, competitors: [{ sku: "OTHER" }] },
      { target: { descriptionCategoryId: 10, typeId: 20 }, competitors: [] },
    ];
    expect(matchingCompetitorReports({ rawInfo: { description_category_id: 10, type_id: 20 } }, reports))
      .toEqual([reports[0]]);
    expect(matchingCompetitorReports({ rawInfo: {} }, reports)).toEqual([]);
  });

  it("only analyzes the diagnosed product's category when drafting content", () => {
    expect(contentDraftCategoryFromProduct({ rawInfo: { description_category_id: 10, type_id: 20 } }))
      .toEqual({ descriptionCategoryId: 10, typeId: 20 });
    expect(contentDraftCategoryFromProduct({ rawInfo: { description_category_id: 10 } }))
      .toBeNull();
    expect(contentDraftCategoryFromProduct({ rawInfo: { description_category_id: "Infinity", type_id: 20 } }))
      .toBeNull();
  });

  it("prefers a product with a title or description issue over an image-only issue", () => {
    expect(selectContentDraftTarget([
      { offerId: "IMAGE", recommendations: ["Добавьте фотографии"] },
      { offerId: "COPY", recommendations: ["Заполните описание"] },
    ])).toBe("COPY");
    expect(selectContentDraftTarget([
      { offerId: "IMAGE", recommendations: ["Добавьте фотографии"] },
    ])).toBe("IMAGE");
    expect(selectContentDraftTarget([])).toBeNull();
  });

  it("reads the requested competitor count per category", () => {
    expect(competitorsPerCategoryFromPrompt("每个类目分析 8 个竞品")).toBe(8);
    expect(competitorsPerCategoryFromPrompt("分析五个同类竞品")).toBe(5);
    expect(competitorsPerCategoryFromPrompt("每个类目 7 个")).toBe(7);
    expect(competitorsPerCategoryFromPrompt("5个")).toBe(5);
    expect(competitorsPerCategoryFromPrompt("分析店铺竞品")).toBe(1);
  });

  it("requires a store snapshot for own-store data questions", () => {
    expect(requiredOzonToolForPrompt("自己店铺现在有多少商品？", null)).toBe(
      "get_ozon_store_snapshot",
    );
  });

  it("requires product content reads when an offerId is present", () => {
    expect(requiredOzonToolForPrompt("查一下 offerId SKU-123 的商品状态", "SKU-123")).toBe(
      "get_ozon_product_content",
    );
  });

  it("treats editing product copy without an offerId as a content task", () => {
    expect(requiredOzonToolForPrompt("帮我修改店铺商品标题", null)).toBe("diagnose_ozon_store");
    expect(requiredOzonToolForPrompt("完善商品简介", null)).toBe("diagnose_ozon_store");
  });

  it("does not require Ozon tools for plain chat", () => {
    expect(requiredOzonToolForPrompt("你好", null)).toBeNull();
  });

  it("requires the diagnosis tool for store diagnosis requests", () => {
    expect(requiredOzonToolForPrompt("给我的店铺做一次完整诊断", null)).toBe(
      "diagnose_ozon_store",
    );
    expect(shouldRunCompetitorAnalysisForDiagnosis("给我的店铺做一次完整诊断")).toBe(false);
    expect(competitorsPerCategoryFromPrompt("给我的店铺做一次完整诊断")).toBeNull();
    expect(shouldCreateFallbackContentDraft("给我的店铺做一次完整诊断", null)).toBe(true);
    expect(shouldCreateFallbackContentDraft("给店铺做诊断，只看库存", null)).toBe(false);
    expect(requiredOzonToolsForPrompt("给我的店铺做一次完整诊断", null)).toEqual([
      "diagnose_ozon_store",
      "record_diagnosis_findings",
    ]);
  });

  it("uses store diagnosis to pick a product when content optimization has no offerId", () => {
    expect(requiredOzonToolForPrompt("内容优化", null)).toBe("diagnose_ozon_store");
  });

  it("requires competitor evidence for competitor analysis", () => {
    expect(requiredOzonToolForPrompt("每个类目分析5个竞品", null)).toBe(
      "analyze_ozon_competitors",
    );
    expect(requiredOzonToolForPrompt("根据我的店铺商品做一个竞品分析，分析5个商品数据", null)).toBe(
      "analyze_ozon_competitors",
    );
    expect(requiredOzonToolForPrompt("分析店铺竞品", null)).toBe("analyze_ozon_competitors");
  });

  it("reuses saved competitor evidence without forcing a fresh crawl", () => {
    expect(requiredOzonToolForPrompt(
      "根据已保存的竞品分析和类目属性经验，帮我检查一个商品，并生成一条可执行的修改建议。先不要直接执行，等我确认。",
      null,
    )).toBeNull();
  });

  it("requires promotion data for campaign requests", () => {
    expect(requiredOzonToolForPrompt("看看有什么活动可以报名", null)).toBe(
      "list_ozon_promotions",
    );
  });

  it("serializes successful store tool calls as visible data sources", () => {
    const sources = contentAgentDataSourcesFromToolCalls([
      {
        name: "get_ozon_store_snapshot",
        at: "2026-08-31T13:56:23.573Z",
        output: {
          storeName: "真实 Ozon 店铺",
          productCount: 978,
          visibleProductCount: 0,
          totalStock: 68526,
          syncedAt: "2026-08-31T13:56:43.241Z",
        },
      },
    ]);

    expect(sources).toEqual([
      {
        toolName: "get_ozon_store_snapshot",
        label: "Ozon 店铺实时快照",
        status: "ok",
        at: "2026-08-31T13:56:23.573Z",
        storeName: "真实 Ozon 店铺",
        productCount: 978,
        visibleProductCount: 0,
        totalStock: 68526,
        syncedAt: "2026-08-31T13:56:43.241Z",
        error: null,
      },
    ]);
  });

  it("summarizes saved competitor evidence as reusable memory", () => {
    const context = competitorMemoryContextFromReports([
      {
        title: "类目属性经验 v4：200000933:93194",
        createdAt: new Date("2026-09-10T16:40:00.000Z"),
        reportJson: {
          kind: "category_attribute_playbook",
          sampleSize: 5,
          attributes: [
            { ozonNameRu: "Сезон", commonValues: [{ value: "Лето" }] },
            { ozonNameRu: "Материал", commonValues: [{ value: "Хлопок" }] },
          ],
        },
      },
      {
        title: "竞品分析：Мужское поло",
        createdAt: new Date("2026-09-10T16:39:00.000Z"),
        reportJson: {
          source: "ozon_http_crawler",
          target: { offerId: "SKU-1" },
          category: { name: "Поло" },
          competitors: [{ sku: "c1" }, { sku: "c2" }],
        },
      },
    ]);

    expect(context).toContain("默认复用");
    expect(context).toContain("200000933:93194(5样本)");
    expect(context).toContain("Сезон=Лето");
    expect(context).toContain("Поло 2个 ozon_http_crawler");
  });

  it("includes Apify evidence only for the selected store", () => {
    const reports = ["store-a", "store-b"].map((storeId) => ({
      title: `竞品分析：${storeId}`,
      createdAt: new Date("2026-09-28T00:00:00Z"),
      reportJson: { storeId, source: "apify_ozon_scraper", target: { offerId: storeId },
        category: { name: storeId }, competitors: [{ sku: "competitor" }] },
    }));
    const context = competitorMemoryContextFromReports(reports, "store-a");
    expect(context).toContain("store-a 1个 apify_ozon_scraper");
    expect(context).not.toContain("store-b");
  });

  it("shows the full-store competitor diagnosis product count", () => {
    const sources = contentAgentDataSourcesFromToolCalls([{
      name: "analyze_ozon_competitors",
      at: "2026-09-08T10:30:32.031Z",
      output: {
        storeName: "真实 Ozon 店铺",
        reportCount: 5,
        analyzedProductCount: 87,
        competitorCount: 20,
        categories: ["Поло", "Худи"],
      },
    }]);

    expect(sources[0]).toMatchObject({
      competitorReportCount: 5,
      analyzedProductCount: 87,
      competitorCount: 20,
    });
  });

  it("formats category experience with Chinese translations after Russian text", () => {
    const summary = categoryExperienceSummary([{
      kind: "category_attribute_playbook",
      schemaVersion: 1,
      categoryKey: "200000933:93194",
      descriptionCategoryId: 200000933,
      typeId: 93194,
      categoryName: "Поло",
      sampleSize: 5,
      capturedAt: "2026-09-17T00:00:00.000Z",
      attributes: [
        {
          competitorNameRu: "Сезон",
          ozonAttributeId: 4495,
          ozonNameRu: "Сезон",
          required: false,
          dictionaryId: 1,
          coverageCount: 5,
          coverageRate: 1,
          mappingStatus: "EXACT",
          commonValues: [{ value: "На любой сезон", count: 5, rate: 1, dictionaryValueId: 1 }],
          evidenceUrls: ["https://www.ozon.ru/product/1/"],
        },
        {
          competitorNameRu: "Тип",
          ozonAttributeId: 8229,
          ozonNameRu: "Тип",
          required: true,
          dictionaryId: 2,
          coverageCount: 5,
          coverageRate: 1,
          mappingStatus: "EXACT",
          commonValues: [{ value: "Поло", count: 5, rate: 1, dictionaryValueId: 2 }],
          evidenceUrls: ["https://www.ozon.ru/product/2/"],
        },
      ],
      descriptionPatterns: { availableCount: 0, averageLength: 0, samples: [] },
    }]);

    expect(summary).toContain("Поло（Polo衫）");
    expect(summary).toContain("Сезон（季节）");
    expect(summary).toContain("На любой сезон（四季通用）");
    expect(summary).toContain("Тип（商品类型）");
  });
});
