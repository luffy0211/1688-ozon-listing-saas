import { describe, expect, it } from "vitest";
import {
  attachCompetitorCategoryLabels,
  buildCompetitorBatchProposal,
  buildStoreDiagnosis,
  cachedCompetitorReport,
  countUniqueCompetitors,
  lowContentRatingProducts,
  selectCompetitorTargets,
  summarizeFinanceTransactions,
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

  it("does not reuse incomplete competitor reports", () => {
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
      imageUrls: [],
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
      imageUrls: [],
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
      imageUrls: [],
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
