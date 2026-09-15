import { describe, expect, it } from "vitest";
import {
  competitorsPerCategoryFromPrompt,
  competitorMemoryContextFromReports,
  contentAgentModelSettings,
  contentAgentDataSourcesFromToolCalls,
  normalizeOzonProductContent,
  requiredOzonToolForPrompt,
  shouldRefreshCompetitorEvidence,
} from "./content-agent";

describe("contentAgentModelSettings", () => {
  it("disables DeepSeek thinking for multi-turn tool compatibility", () => {
    expect(contentAgentModelSettings("https://api.deepseek.com")).toEqual({
      providerData: { thinking: { type: "disabled" } },
    });
    expect(contentAgentModelSettings("https://api.openai.com/v1")).toEqual({});
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
    expect(product.stock).toBe(0);
  });
});

describe("content agent tool enforcement helpers", () => {
  it("refreshes Tavily evidence only when the user explicitly requests it", () => {
    expect(shouldRefreshCompetitorEvidence("使用之前采集的信息做全店诊断")).toBe(false);
    expect(shouldRefreshCompetitorEvidence("重新采集竞品，每个类目5个")).toBe(true);
    expect(shouldRefreshCompetitorEvidence("刷新竞品数据，每个类目5个")).toBe(true);
  });

  it("reads the requested competitor count per category", () => {
    expect(competitorsPerCategoryFromPrompt("每个类目分析 8 个竞品")).toBe(8);
    expect(competitorsPerCategoryFromPrompt("分析五个同类竞品")).toBe(5);
    expect(competitorsPerCategoryFromPrompt("每个类目 7 个")).toBe(7);
    expect(competitorsPerCategoryFromPrompt("5个")).toBe(5);
    expect(competitorsPerCategoryFromPrompt("分析店铺竞品")).toBeNull();
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

  it("does not require Ozon tools for plain chat", () => {
    expect(requiredOzonToolForPrompt("你好", null)).toBeNull();
  });

  it("requires the diagnosis tool for store diagnosis requests", () => {
    expect(requiredOzonToolForPrompt("给我的店铺做一次完整诊断", null)).toBe(
      "diagnose_ozon_store",
    );
  });

  it("requires competitor evidence for competitor analysis", () => {
    expect(requiredOzonToolForPrompt("每个类目分析5个竞品", null)).toBe(
      "analyze_ozon_competitors",
    );
    expect(requiredOzonToolForPrompt("根据我的店铺商品做一个竞品分析，分析5个商品数据", null)).toBe(
      "analyze_ozon_competitors",
    );
    expect(requiredOzonToolForPrompt("分析店铺竞品", null)).toBeNull();
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
});
