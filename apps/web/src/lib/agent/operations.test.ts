import { describe, expect, it, vi } from "vitest";
vi.mock("@saas/db", () => ({ prisma: {}, decryptSecret: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: {} }));
import {
  attachCompetitorCategoryLabels,
  buildCompetitorBatchProposal,
  buildCompetitorContentDiagnosis,
  buildStoreDiagnosis,
  cachedReportForTarget,
  countBillableCompetitorCategories,
  cachedCompetitorReport,
  countUniqueCompetitors,
  lowContentRatingProducts,
  selectCompetitorDiagnosisTargets,
  selectCompetitorTargets,
  summarizeCompetitorEvidence,
  summarizeProductRecommendations,
  summarizeFinanceTransactions,
  hydrateOwnProductTargets,
  targetsForCompetitorCategory,
} from "./operations";

const categoryTree = [
  {
    description_category_id: 17027904,
    category_name: "Одежда",
    children: [
      {
        category_name: "Мужская одежда",
        children: [{ type_id: 93337, type_name: "Поло" }],
      },
    ],
  },
];

const summary = (overrides: Record<string, unknown> = {}) => ({
  productCount: 10,
  visibleProductCount: 8,
  archivedProductCount: 1,
  totalStock: 80,
  lowStockCount: 2,
  fbsOrderCount: 7,
  fboOrderCount: 3,
  pendingShipmentCount: 1,
  cancelledOrderCount: 1,
  grossRevenueRub: 10_000,
  orderDataStatus: {
    state: "complete" as const,
    fbs: { state: "complete" as const },
    fbo: { state: "complete" as const },
  },
  dailyOrders: [
    { date: "2026-09-01", fbs: 2, fbo: 1 },
    { date: "2026-09-02", fbs: 1, fbo: 0 },
  ],
  topProducts: [],
  products: [],
  warnings: [],
  ...overrides,
});

describe("Ozon operations helpers", () => {
  it("does not bill categories that have no cache and cannot be collected", () => {
    const pending = [
      { descriptionCategoryId: 10, typeId: 20, categoryNameRu: "Поло" },
      { descriptionCategoryId: 10, typeId: null, categoryNameRu: null },
    ];
    expect(countBillableCompetitorCategories([{}], pending as never, false)).toBe(1);
    expect(countBillableCompetitorCategories([{}], pending as never, true)).toBe(2);
  });
  it("limits a targeted optimization to the same Ozon category", () => {
    const targets = [
      { descriptionCategoryId: 10, typeId: 20 },
      { descriptionCategoryId: 10, typeId: 21 },
    ];
    expect(targetsForCompetitorCategory(targets as never, { descriptionCategoryId: 10, typeId: 20 }))
      .toEqual([targets[0]]);
    expect(targetsForCompetitorCategory(targets as never, null)).toEqual(targets);
  });
  it("summarizes competitor evidence quality and crawler blocking risks", () => {
    const targets = [
      { descriptionCategoryId: 10, typeId: 20, offerId: "a", title: "Поло" },
      { descriptionCategoryId: 10, typeId: 30, offerId: "b", title: "Рубашка" },
    ];

    const quality = summarizeCompetitorEvidence({
      requestedPerCategory: 5,
      targets: targets as never,
      reports: [{
        target: targets[0],
        category: { name: "Поло" },
        source: "ozon_http_crawler",
        competitors: [{ sku: "1" }, { sku: "2" }, { sku: "3" }, { sku: "4" }, { sku: "5" }],
        cached: true,
      }],
      warnings: ["a：page1 扫描失败: HTTP 403"],
    });

    expect(quality).toMatchObject({
      categoryCount: 2,
      coveredCategoryCount: 1,
      sufficientCategoryCount: 1,
      insufficientCategoryCount: 1,
      competitorCount: 5,
      reusedCacheCount: 1,
      hasCrawlerBlocked: true,
    });
    expect(quality.insufficientCategories).toEqual([
      expect.objectContaining({ categoryName: "Рубашка", competitorCount: 0 }),
    ]);
  });

  it("builds one approval-gated batch from evidence-backed attribute additions", () => {
    const proposal = buildCompetitorBatchProposal({
      storeId: "store-1",
      reportIds: ["report-1"],
      productRecommendations: [
        {
          offerId: "offer-1",
          productId: "44",
          categoryKey: "1:2",
          categoryMatches: true,
          recommendations: [
            {
              ozonAttributeId: 10,
              ozonNameRu: "Материал",
              competitorNameRu: "Материал",
              required: false,
              status: "ADD",
              currentValues: [],
              suggestedValue: "Хлопок",
              dictionaryValueId: 1001,
              evidenceSource: "OWN_CONTENT",
              competitorCoverageRate: 1,
              evidenceUrls: ["https://www.ozon.ru/product/1/"],
              reasonZh: "自家描述包含该值。",
            },
          ],
          actionableCount: 1,
          actionAttributes: [
            { id: 10, values: [{ value: "Хлопок", dictionaryValueId: 1001 }] },
          ],
        },
        {
          offerId: "offer-2",
          productId: "45",
          categoryKey: "1:2",
          categoryMatches: true,
          recommendations: [],
          actionableCount: 0,
          actionAttributes: null,
        },
      ],
    });

    expect(proposal).toMatchObject({
      type: "BULK_PRODUCT_UPDATE",
      storeId: "store-1",
      riskLevel: "MEDIUM",
      payload: {
        source: "competitor_attribute_playbook",
        reportIds: ["report-1"],
        items: [
          {
            type: "UPDATE_ATTRIBUTES",
            offerId: "offer-1",
            productId: "44",
            attributes: [
              { id: 10, values: [{ value: "Хлопок", dictionaryValueId: 1001 }] },
            ],
          },
        ],
      },
    });
    expect(proposal?.payload.recommendations).toHaveLength(1);
  });

  it("summarizes full-store recommendations without returning every completed attribute", () => {
    const summary = summarizeProductRecommendations([
      {
        offerId: "offer-1",
        productId: "1",
        categoryKey: "10:20",
        categoryMatches: true,
        recommendations: [
          { status: "COMPLETE", ozonNameRu: "Материал" },
          { status: "ADD", ozonNameRu: "Тип", suggestedValue: "Поло" },
        ],
        actionableCount: 1,
        actionAttributes: [{ id: 1, values: [{ value: "Поло" }] }],
      },
      {
        offerId: "offer-2",
        productId: "2",
        categoryKey: "10:20",
        categoryMatches: true,
        recommendations: [{ status: "NEEDS_CONFIRMATION", ozonNameRu: "Состав" }],
        actionableCount: 0,
        actionAttributes: null,
      },
    ] as never);

    expect(summary).toMatchObject({
      productCount: 2,
      actionableProductCount: 1,
      needsConfirmationProductCount: 1,
      statusCounts: { COMPLETE: 1, ADD: 1, NEEDS_CONFIRMATION: 1, UNMAPPED: 0 },
    });
    expect(summary.actionableProducts).toHaveLength(1);
  });

  it("does not create a batch when every suggestion needs confirmation", () => {
    expect(buildCompetitorBatchProposal({
      storeId: "store-1",
      reportIds: ["report-1"],
      productRecommendations: [{
        offerId: "offer-1",
        productId: "44",
        categoryKey: "1:2",
        categoryMatches: true,
        recommendations: [],
        actionableCount: 0,
        actionAttributes: null,
      }],
    })).toBeNull();
  });

  it("builds content-focused competitor diagnosis for visible comparison fields", async () => {
    const product = (sku: string, overrides: Record<string, unknown> = {}) => ({
      sku,
      url: `https://www.ozon.ru/product/${sku}/`,
      title: `Мужское поло хлопковое ${sku}`,
      priceRub: 1200,
      oldPriceRub: null,
      rating: 4.8,
      reviewCount: 32,
      sellerName: "seller",
      imageUrls: [`https://ir.ozone.ru/s3/${sku}.jpg`],
      attributes: {},
      description: "Легкое поло из хлопка для города и офиса",
      reviews: [],
      ...overrides,
    });

    const diagnosis = await buildCompetitorContentDiagnosis([{
      target: { offerId: "offer-1", title: "Поло", categoryNameRu: "Поло", descriptionCategoryId: 10, typeId: 20 },
      capturedAt: "2026-09-01T00:00:00.000Z",
      category: { name: "Поло" },
      ownProduct: product("own", { priceRub: 999, reviewCount: 2 }),
      competitors: [
        product("c1", { priceRub: 1290, reviewCount: 40 }),
        product("c2", { priceRub: 1490, reviewCount: 60 }),
        product("c3", { priceRub: 1690, reviewCount: 80 }),
      ],
    }]);

    expect(diagnosis).toMatchObject({
      kind: "competitor_content_diagnosis",
      heatProxyNotice: expect.stringContaining("真实销量"),
      samples: [
        expect.objectContaining({
          offerId: "offer-1",
          descriptionCategoryId: 10,
          typeId: 20,
          capturedAt: "2026-09-01T00:00:00.000Z",
          comparison: expect.objectContaining({
            price: { ownRub: 999, competitorMedianRub: 1490 },
            heat: expect.objectContaining({ ownReviewCount: 2, competitorMedianReviewCount: 60 }),
            themes: expect.objectContaining({
              titleTerms: expect.any(Array),
              ownTerms: expect.arrayContaining([expect.objectContaining({ term: "хлопковое" })]),
            }),
            description: expect.objectContaining({ ownAvailable: true, competitorAvailableCount: 3 }),
          }),
        }),
      ],
    });
    expect(diagnosis.vision.warning).toContain("视觉分析未启用");
  });

  it("rejects incomplete reports but reuses valid competitor evidence without images", () => {
    expect(cachedCompetitorReport({ source: "ozon_public_category", competitors: [] })).toBeNull();
    expect(cachedCompetitorReport({ source: "ozon_public_category", competitors: [{}] })).toBeNull();
    expect(cachedCompetitorReport({
      source: "ozon_search_index",
      category: { url: "https://www.ozon.ru/category/example-1/" },
      competitors: [{ sku: "1" }],
    })).toBeNull();
    expect(cachedCompetitorReport({
      source: "ozon_search_index",
      detailScope: "search_index_attributes_description",
      category: { url: "https://www.ozon.ru/category/example-1/" },
      competitors: [{ sku: "1" }],
    })).toBeNull();
    const imageLessProduct = {
      sku: "1",
      url: "https://www.ozon.ru/product/1/",
      title: "Мужское поло",
      priceRub: null,
      oldPriceRub: null,
      rating: null,
      reviewCount: null,
      sellerName: null,
      imageUrls: [],
      attributes: { Материал: "Хлопок" },
      description: "Описание",
      reviews: [],
    };
    expect(cachedCompetitorReport({
      source: "ozon_search_index",
      detailScope: "category_search_index_attributes_description_v3",
      category: { url: "https://www.ozon.ru/search/?text=polo" },
      ownProduct: { ...imageLessProduct, sku: "own" },
      competitors: [imageLessProduct],
    })).not.toBeNull();
    expect(cachedCompetitorReport({
      source: "apify_ozon_scraper",
      detailScope: "category_search_index_attributes_description_v3",
      category: { url: "https://www.ozon.ru/search/?text=polo" },
      ownProduct: { ...imageLessProduct, sku: "own" },
      competitors: [imageLessProduct],
    })).not.toBeNull();
  });

  it("rebuilds cached own-product data for the current category target", () => {
    const report = cachedReportForTarget({
      capturedAt: "2026-09-01T00:00:00.000Z",
      target: { offerId: "old", title: "Old product", publicSku: "1" },
      ownProduct: { sku: "1", title: "Old product", imageUrls: ["https://ir.ozone.ru/s3/old.jpg"] },
      competitors: [],
    }, {
      offerId: "current",
      title: "Current product",
      publicSku: "2",
      imageUrl: "https://ir.ozone.ru/s3/current.jpg",
      imageUrls: [
        "https://ir.ozone.ru/s3/current.jpg",
        "https://ir.ozone.ru/s3/current-2.jpg",
        "https://ir.ozone.ru/s3/current-3.jpg",
      ],
      description: "Current Seller API description",
      descriptionReadState: "available",
      priceRub: 299,
      quantity: 0,
      revenueRub: 0,
    });

    expect(report).toMatchObject({
      target: { offerId: "current", publicSku: "2" },
      ownProduct: {
        sku: "2",
        title: "Current product",
        priceRub: 299,
        imageUrls: [
          "https://ir.ozone.ru/s3/current.jpg",
          "https://ir.ozone.ru/s3/current-2.jpg",
          "https://ir.ozone.ru/s3/current-3.jpg",
        ],
        description: "Current Seller API description",
      },
      cached: true,
      capturedAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("hydrates own-product images and the 4191 description from Seller API details", async () => {
    const client = {
      getProductInfoList: async () => [{
        offer_id: "offer-1",
        name: "Current product",
        images: [
          "https://ir.ozone.ru/s3/current.jpg",
          "https://ir.ozone.ru/s3/current-2.jpg",
        ],
      }],
      getProductInfoAttributes: async () => [{
        offer_id: "offer-1",
        description: null,
        attributes: [{ id: 4191, values: [{ value: "Description from attribute" }] }],
      }],
    };

    const result = await hydrateOwnProductTargets(client as never, [{
      offerId: "offer-1",
      title: "Summary title",
      publicSku: "100",
      quantity: 0,
      revenueRub: 0,
    }]);

    expect(result).toEqual({
      targets: [expect.objectContaining({
        title: "Current product",
        imageUrls: [
          "https://ir.ozone.ru/s3/current.jpg",
          "https://ir.ozone.ru/s3/current-2.jpg",
        ],
        description: "Description from attribute",
        descriptionReadState: "available",
      })],
      warnings: [],
    });
  });

  it("does not turn failed order reads into zero-order diagnosis", () => {
    const diagnosis = buildStoreDiagnosis({
      current: summary({
        fbsOrderCount: null,
        fboOrderCount: 2,
        grossRevenueRub: null,
        pendingShipmentCount: null,
        cancelledOrderCount: null,
        orderDataStatus: {
          state: "partial",
          fbs: { state: "failed", errorKind: "timeout" },
          fbo: { state: "complete" },
        },
        warnings: ["FBS 订单同步失败：request timeout"],
      }) as never,
      previous: summary(),
      finance: {
        transactionCount: 0,
        salesAccrualRub: 0,
        ozonNetPayoutRub: 0,
        salesCommissionRub: 0,
        deliveryFeesRub: 0,
        serviceFeesRub: 0,
        platformFeesRub: 0,
      },
    });

    expect(diagnosis.current30d.orderCount).toBeNull();
    expect(diagnosis.current30d.orderRevenueRub).toBeNull();
    expect(diagnosis.comparison.orderCountChangeRate).toBeNull();
    expect(diagnosis.issues).not.toContain("最近 30 天没有读取到订单");
    expect(diagnosis.orderDataStatus.state).toBe("partial");
  });

  it("rebuilds content benchmarks from cached competitor details", () => {
    const product = (sku: string, attributes: Record<string, string>) => ({
      sku,
      url: `https://www.ozon.ru/product/${sku}/`,
      title: "Мужское поло",
      priceRub: null,
      oldPriceRub: null,
      rating: null,
      reviewCount: null,
      sellerName: null,
      imageUrls: [`https://ir.ozone.ru/s3/${sku}.jpg`],
      attributes,
      description: "Хлопковое поло для повседневной носки.",
      reviews: [],
    });
    const report = cachedCompetitorReport({
      source: "ozon_search_index",
      detailScope: "category_search_index_attributes_description_v3",
      category: { url: "https://www.ozon.ru/search/?text=polo" },
      ownProduct: product("own", {}),
      competitors: [product("1", { Материал: "Хлопок" }), product("2", { Материал: "Хлопок" })],
      benchmarks: { sampleSize: 2 },
    });

    expect(report).toMatchObject({
      benchmarks: {
        content: {
          attributePatterns: [expect.objectContaining({ name: "Материал", coverageRate: 1 })],
        },
      },
    });
    expect(cachedCompetitorReport({
      source: "ozon_search_index",
      detailScope: "search_index_attributes_description",
      category: { url: "https://www.ozon.ru/search/?text=polo" },
      ownProduct: product("own", {}),
      competitors: [product("1", { Материал: "Хлопок" })],
    })).toBeNull();
  });

  it("reuses competitor cache only when it covers the requested per-category count", () => {
    const product = (sku: string) => ({
      sku,
      url: `https://www.ozon.ru/product/${sku}/`,
      title: "Мужское поло",
      priceRub: null,
      oldPriceRub: null,
      rating: null,
      reviewCount: null,
      sellerName: null,
      imageUrls: [`https://ir.ozone.ru/s3/${sku}.jpg`],
      attributes: { Материал: "Хлопок" },
      description: null,
      reviews: [],
    });
    const report = {
      source: "ozon_search_index",
      detailScope: "category_search_index_attributes_description_v3",
      category: { url: "https://www.ozon.ru/search/?text=polo" },
      ownProduct: product("own"),
      competitors: [product("1")],
      competitorsPerCategory: 3,
    };

    expect(cachedCompetitorReport(report, 3)).not.toBeNull();
    expect(cachedCompetitorReport({ ...report, source: "ozon_http_crawler" }, 3)).not.toBeNull();
    expect(cachedCompetitorReport(report, 5)).toBeNull();
  });

  it("rejects cached competitor attributes with invalid value types", () => {
    const malformed = {
      sku: "1",
      url: "https://www.ozon.ru/product/1/",
      title: "Мужское поло",
      priceRub: null,
      oldPriceRub: null,
      rating: null,
      reviewCount: null,
      sellerName: null,
      imageUrls: [],
      attributes: { Материал: ["Хлопок"] },
      description: null,
      reviews: [],
    };

    expect(cachedCompetitorReport({
      source: "ozon_search_index",
      detailScope: "category_search_index_attributes_description_v3",
      category: { url: "https://www.ozon.ru/search/?text=polo" },
      ownProduct: { ...malformed, sku: "own", attributes: {} },
      competitors: [malformed],
    })).toBeNull();
  });

  it("deduplicates cached competitors and removes empty evidence", () => {
    const product = (sku: string, attributes: Record<string, string>, description: string | null = null) => ({
      sku,
      url: `https://www.ozon.ru/product/${sku}/`,
      title: "Мужское поло",
      priceRub: null,
      oldPriceRub: null,
      rating: null,
      reviewCount: null,
      sellerName: null,
      imageUrls: [`https://ir.ozone.ru/s3/${sku}.jpg`],
      attributes,
      description,
      reviews: [],
    });
    const report = cachedCompetitorReport({
      source: "ozon_search_index",
      detailScope: "category_search_index_attributes_description_v3",
      category: { url: "https://www.ozon.ru/search/?text=polo" },
      ownProduct: product("own", {}),
      competitors: [
        product("1", { Материал: "Хлопок" }),
        product("1", { Материал: "Хлопок" }),
        product("2", {}),
      ],
    });

    expect(report?.competitors).toHaveLength(1);
    expect(countUniqueCompetitors([report, report])).toBe(1);
  });

  it("summarizes Ozon net payout and platform charges", () => {
    expect(
      summarizeFinanceTransactions([
        {
          amount: 700,
          accruals_for_sale: 1_000,
          sale_commission: -150,
          delivery_charge: -50,
          return_delivery_charge: 0,
          services: [{ price: -100 }],
        },
      ]),
    ).toEqual({
      transactionCount: 1,
      salesAccrualRub: 1_000,
      ozonNetPayoutRub: 700,
      salesCommissionRub: 150,
      deliveryFeesRub: 50,
      serviceFeesRub: 100,
      platformFeesRub: 300,
    });
  });

  it("builds period comparisons without calling net payout profit", () => {
    const diagnosis = buildStoreDiagnosis({
      current: summary(),
      previous: summary({ fbsOrderCount: 4, fboOrderCount: 1, grossRevenueRub: 8_000 }),
      finance: {
        transactionCount: 1,
        salesAccrualRub: 10_000,
        ozonNetPayoutRub: 7_000,
        salesCommissionRub: 1_500,
        deliveryFeesRub: 500,
        serviceFeesRub: 1_000,
        platformFeesRub: 3_000,
      },
      capturedAt: "2026-09-06T00:00:00.000Z",
    });

    expect(diagnosis.current30d.orderCount).toBe(10);
    expect(diagnosis.comparison.orderCountChangeRate).toBe(1);
    expect(diagnosis.finance.ozonNetPayoutRub).toBe(7_000);
    expect(diagnosis).not.toHaveProperty("profit");
  });

  it("selects one top-selling representative per store category", () => {
    expect(
      selectCompetitorTargets(
        summary({
          topProducts: [
            { offerId: "best", name: "Best", quantity: 8, revenueRub: 900 },
            { offerId: "same-category", name: "Same category", quantity: 6, revenueRub: 700 },
            { offerId: "other-category", name: "Other category", quantity: 4, revenueRub: 500 },
          ],
          products: [
            { offerId: "best", name: "Best", publicSku: "9001", visible: true, archived: false, stock: 2, descriptionCategoryId: 17027904, typeId: 93337 },
            { offerId: "same-category", name: "Same category", publicSku: "9002", visible: true, archived: false, stock: 9, descriptionCategoryId: 17027904, typeId: 93337 },
            { offerId: "other-category", name: "Other category", publicSku: "9003", visible: true, archived: false, stock: 5, descriptionCategoryId: 17027904, typeId: 94444 },
          ],
        }) as never,
      ),
    ).toEqual([
      {
        offerId: "best",
        title: "Best",
        publicSku: "9001",
        quantity: 8,
        revenueRub: 900,
        descriptionCategoryId: 17027904,
        typeId: 93337,
        categoryNameRu: null,
        categoryPathRu: [],
      },
      {
        offerId: "other-category",
        title: "Other category",
        publicSku: "9003",
        quantity: 4,
        revenueRub: 500,
        descriptionCategoryId: 17027904,
        typeId: 94444,
        categoryNameRu: null,
        categoryPathRu: [],
      },
    ]);
  });

  it("keeps the own-product image in competitor targets", () => {
    expect(selectCompetitorTargets(summary({
      products: [{
        offerId: "own",
        name: "Own product",
        publicSku: "100",
        imageUrl: "https://ir.ozone.ru/s3/multimedia-own.jpg",
        visible: true,
        archived: false,
        stock: 5,
        descriptionCategoryId: 17027904,
        typeId: 93337,
      }],
    }) as never)[0]).toMatchObject({
      offerId: "own",
      imageUrl: "https://ir.ozone.ru/s3/multimedia-own.jpg",
    });
  });

  it("keeps one representative for every selling category", () => {
    const products = Array.from({ length: 6 }, (_, index) => ({
      offerId: `offer-${index}`,
      name: `Product ${index}`,
      publicSku: `sku-${index}`,
      visible: true,
      archived: false,
      stock: 10 - index,
      descriptionCategoryId: 17027904,
      typeId: 93000 + index,
    }));

    expect(selectCompetitorTargets(summary({ products }) as never)).toHaveLength(6);
  });

  it("keeps hidden non-archived categories when visible products exist", () => {
    const targets = selectCompetitorTargets(summary({
      products: [
        { offerId: "visible", name: "Visible", publicSku: "sku-1", visible: true, archived: false, stock: 5, descriptionCategoryId: 17027904, typeId: 93337 },
        { offerId: "hidden-category", name: "Hidden category", publicSku: "sku-2", visible: false, archived: false, stock: 0, descriptionCategoryId: 17027904, typeId: 94444 },
      ],
    }) as never);

    expect(targets.map((target) => target.offerId)).toEqual(["visible", "hidden-category"]);
  });

  it("diagnoses every non-archived store product in the analyzed categories", () => {
    const representatives = [{
      offerId: "representative",
      title: "Representative",
      publicSku: "sku-1",
      quantity: 3,
      revenueRub: 300,
      descriptionCategoryId: 17027904,
      typeId: 93337,
      categoryNameRu: "Поло",
      categoryPathRu: ["Одежда", "Мужская одежда", "Поло"],
    }];

    expect(selectCompetitorDiagnosisTargets(summary({
      products: [
        { offerId: "representative", name: "Representative", publicSku: "sku-1", visible: true, archived: false, stock: 5, descriptionCategoryId: 17027904, typeId: 93337 },
        { offerId: "hidden", name: "Hidden", publicSku: "sku-2", visible: false, archived: false, stock: 0, descriptionCategoryId: 17027904, typeId: 93337 },
        { offerId: "archived", name: "Archived", publicSku: "sku-3", visible: false, archived: true, stock: 0, descriptionCategoryId: 17027904, typeId: 93337 },
        { offerId: "other-category", name: "Other", publicSku: "sku-4", visible: true, archived: false, stock: 8, descriptionCategoryId: 17027904, typeId: 94444 },
      ],
    }) as never, representatives)).toEqual([
      expect.objectContaining({ offerId: "representative", categoryNameRu: "Поло" }),
      expect.objectContaining({ offerId: "hidden", categoryNameRu: "Поло" }),
    ]);
  });

  it("falls back to visible stocked products when category data is unavailable", () => {

    expect(
      selectCompetitorTargets(
        summary({
          products: [
            { offerId: "hidden", name: "Hidden", publicSku: "9003", visible: false, archived: false, stock: 20 },
            { offerId: "stocked", name: "Stocked", publicSku: "9004", visible: true, archived: false, stock: 9 },
          ],
        }) as never,
      ),
    ).toEqual([{
      offerId: "stocked",
      title: "Stocked",
      publicSku: "9004",
      quantity: 0,
      revenueRub: 0,
      descriptionCategoryId: null,
      typeId: null,
      categoryNameRu: null,
      categoryPathRu: [],
    }]);
  });

  it("attaches the exact Ozon type and category path to competitor targets", () => {
    const [target] = attachCompetitorCategoryLabels(categoryTree, [{
      offerId: "offer-1",
      title: "Поло мужское",
      publicSku: "9001",
      quantity: 0,
      revenueRub: 0,
      descriptionCategoryId: 17027904,
      typeId: 93337,
      categoryNameRu: null,
      categoryPathRu: [],
    }]);

    expect(target).toMatchObject({
      categoryNameRu: "Поло",
      categoryPathRu: ["Одежда", "Мужская одежда", "Поло"],
    });
  });

  it("falls back to hidden inventory when a store has no sales or visible products", () => {
    expect(
      selectCompetitorTargets(
        summary({
          products: [
            { offerId: "missing-sku", name: "Missing SKU", publicSku: null, visible: false, archived: false, stock: 99 },
            { offerId: "archived", name: "Archived", publicSku: "9005", visible: false, archived: true, stock: 50 },
            { offerId: "hidden-low", name: "Hidden low", publicSku: "9006", visible: false, archived: false, stock: 3 },
            { offerId: "hidden-high", name: "Hidden high", publicSku: "9007", visible: false, archived: false, stock: 12 },
          ],
        }) as never,
      ),
    ).toEqual([
      { offerId: "hidden-high", title: "Hidden high", publicSku: "9007", quantity: 0, revenueRub: 0, descriptionCategoryId: null, typeId: null, categoryNameRu: null, categoryPathRu: [] },
      { offerId: "hidden-low", title: "Hidden low", publicSku: "9006", quantity: 0, revenueRub: 0, descriptionCategoryId: null, typeId: null, categoryNameRu: null, categoryPathRu: [] },
    ]);
  });

  it("can analyze an unpublished product when the store has no stock", () => {
    expect(
      selectCompetitorTargets(
        summary({
          products: [
            { offerId: "draft", name: "Draft product", publicSku: "9008", visible: false, archived: false, stock: 0 },
          ],
        }) as never,
      ),
    ).toEqual([{ offerId: "draft", title: "Draft product", publicSku: "9008", quantity: 0, revenueRub: 0, descriptionCategoryId: null, typeId: null, categoryNameRu: null, categoryPathRu: [] }]);
  });

  it("sorts low content-rating products and keeps Ozon improvement evidence", () => {
    expect(
      lowContentRatingProducts(
        [
          { productId: "1", offerId: "good", name: "Good", publicSku: "100", imageUrl: null },
          { productId: "2", offerId: "low", name: "Low", publicSku: "200", imageUrl: "low.jpg" },
          { productId: "3", offerId: "archived", name: "Archived", publicSku: "300", archived: true },
        ] as never,
        [
          { sku: 100, rating: 85, groups: [] },
          {
            sku: 200,
            rating: 35,
            groups: [
              {
                key: "media",
                name: "Media",
                rating: 5,
                weight: 30,
                improve_at_least: 1,
                conditions: [{ key: "images", description: "Add images", fulfilled: false, cost: 10 }],
                improve_attributes: [{ id: 77, name: "Season" }],
              },
            ],
          },
          { sku: 300, rating: 10, groups: [] },
        ],
        70,
      ),
    ).toEqual([
      expect.objectContaining({
        offerId: "low",
        publicSku: "200",
        contentRating: 35,
        recommendations: ["Add images", "补充属性：Season"],
      }),
    ]);
  });
});
