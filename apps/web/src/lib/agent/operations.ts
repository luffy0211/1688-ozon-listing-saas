import { Prisma, decryptSecret, prisma } from "@saas/db";
import {
  buildCategoryAttributePlaybook,
  buildProductAttributeRecommendations,
  getOzonAnalyticsSummary,
  OzonClient,
  parseCategoryAttributePlaybook,
  type CategoryNode,
  type OzonProductInfoItem,
  type OzonAnalyticsSummary,
  type OzonFinanceTransaction,
  type OzonProductRating,
  type ProductAttributeRecommendationResult,
} from "@saas/ozon";
import { env } from "@/lib/env";
import {
  buildCompetitorBenchmarks,
  isUsableCompetitorEvidence,
  type OzonCategoryCompetitorResult,
  type OzonCompetitorTarget,
  type OzonPublicProduct,
} from "./ozon-public-crawler";
import {
  crawlOzonCompetitorsWithProcess,
  ozonCrawlerConfigured,
} from "./ozon-crawler-process";
import { searchOzonIndexedCompetitors, uniqueUsableIndexedCompetitors } from "./ozon-search-index";
import { analyzeProductImagesWithVision } from "./image-vision";

type FinanceLike = Pick<
  OzonFinanceTransaction,
  | "amount"
  | "accruals_for_sale"
  | "sale_commission"
  | "delivery_charge"
  | "return_delivery_charge"
  | "services"
>;

export type FinanceSummary = ReturnType<typeof summarizeFinanceTransactions>;

function finite(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function charge(value: unknown) {
  return Math.abs(Math.min(finite(value), 0));
}

export function summarizeFinanceTransactions(transactions: FinanceLike[]) {
  const summary = transactions.reduce(
    (total, transaction) => ({
      transactionCount: total.transactionCount + 1,
      salesAccrualRub: total.salesAccrualRub + finite(transaction.accruals_for_sale),
      ozonNetPayoutRub: total.ozonNetPayoutRub + finite(transaction.amount),
      salesCommissionRub: total.salesCommissionRub + charge(transaction.sale_commission),
      deliveryFeesRub:
        total.deliveryFeesRub +
        charge(transaction.delivery_charge) +
        charge(transaction.return_delivery_charge),
      serviceFeesRub:
        total.serviceFeesRub +
        (transaction.services ?? []).reduce((sum, service) => sum + charge(service.price), 0),
    }),
    {
      transactionCount: 0,
      salesAccrualRub: 0,
      ozonNetPayoutRub: 0,
      salesCommissionRub: 0,
      deliveryFeesRub: 0,
      serviceFeesRub: 0,
    },
  );
  return {
    ...summary,
    platformFeesRub:
      summary.salesCommissionRub + summary.deliveryFeesRub + summary.serviceFeesRub,
  };
}

function orderCount(summary: OzonAnalyticsSummary) {
  return summary.fbsOrderCount + summary.fboOrderCount;
}

function changeRate(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous : null;
}

export function buildStoreDiagnosis(params: {
  current: OzonAnalyticsSummary;
  previous: OzonAnalyticsSummary;
  finance: FinanceSummary;
  capturedAt?: string;
}) {
  const currentOrders = orderCount(params.current);
  const previousOrders = orderCount(params.previous);
  const visibleGap = Math.max(
    params.current.productCount -
      params.current.visibleProductCount -
      params.current.archivedProductCount,
    0,
  );
  const issues = [
    ...(params.current.lowStockCount > 0
      ? [`${params.current.lowStockCount} 个商品库存不高于 5`]
      : []),
    ...(visibleGap > 0 ? [`${visibleGap} 个商品当前不可见且未归档`] : []),
    ...(params.current.cancelledOrderCount > 0
      ? [`${params.current.cancelledOrderCount} 个订单处于取消状态`]
      : []),
    ...(currentOrders === 0 ? ["最近 30 天没有读取到订单"] : []),
  ];

  return {
    capturedAt: params.capturedAt ?? new Date().toISOString(),
    current30d: {
      orderCount: currentOrders,
      orderRevenueRub: params.current.grossRevenueRub,
      productCount: params.current.productCount,
      visibleProductCount: params.current.visibleProductCount,
      archivedProductCount: params.current.archivedProductCount,
      totalStock: params.current.totalStock,
      lowStockCount: params.current.lowStockCount,
      pendingShipmentCount: params.current.pendingShipmentCount,
      cancelledOrderCount: params.current.cancelledOrderCount,
      topProducts: params.current.topProducts.slice(0, 10),
    },
    last7d: {
      orderCount: params.current.dailyOrders
        .slice(-7)
        .reduce((sum, day) => sum + day.fbs + day.fbo, 0),
    },
    previous30d: {
      orderCount: previousOrders,
      orderRevenueRub: params.previous.grossRevenueRub,
    },
    comparison: {
      orderCountChangeRate: changeRate(currentOrders, previousOrders),
      orderRevenueChangeRate: changeRate(
        params.current.grossRevenueRub,
        params.previous.grossRevenueRub,
      ),
    },
    finance: params.finance,
    issues,
    warnings: [...(params.current.warnings ?? []), ...(params.previous.warnings ?? [])],
  };
}

export function lowContentRatingProducts(
  products: OzonAnalyticsSummary["products"],
  ratings: OzonProductRating[],
  threshold = 90,
) {
  const bySku = new Map(ratings.map((rating) => [String(rating.sku), rating]));
  return products
    .flatMap((product) => {
      const rating = product.publicSku ? bySku.get(product.publicSku) : null;
      if (!rating || rating.rating >= threshold) return [];
      const recommendations = new Set<string>();
      rating.groups.forEach((group) => {
        group.conditions
          .filter((condition) => !condition.fulfilled && condition.description)
          .forEach((condition) => recommendations.add(condition.description));
        group.improve_attributes.forEach((attribute) => {
          if (attribute.name) recommendations.add(`补充属性：${attribute.name}`);
        });
      });
      return [{
        productId: product.productId,
        offerId: product.offerId,
        publicSku: product.publicSku,
        title: product.name,
        imageUrl: product.imageUrl,
        visible: product.visible,
        stock: product.stock,
        priceRub: product.priceRub,
        contentRating: rating.rating,
        recommendations: [...recommendations],
        groups: rating.groups,
      }];
    })
    .sort((a, b) => a.contentRating - b.contentRating)
    .slice(0, 20);
}

export function selectCompetitorTargets(summary: OzonAnalyticsSummary) {
  const sales = new Map(summary.topProducts.map((item) => [item.offerId, item]));
  const candidates = summary.products
    .filter((item) => !item.archived && item.name && item.publicSku)
    .sort((a, b) => {
      const aSales = sales.get(a.offerId);
      const bSales = sales.get(b.offerId);
      return (bSales?.revenueRub ?? 0) - (aSales?.revenueRub ?? 0) ||
        (bSales?.quantity ?? 0) - (aSales?.quantity ?? 0) ||
        b.stock - a.stock;
    });
  const visible = candidates.filter((item) => item.visible && item.stock > 0);
  const stocked = candidates.filter((item) => item.stock > 0);
  const pool = visible.length ? visible : stocked.length ? stocked : candidates;
  const categorized = candidates.filter((item) => item.descriptionCategoryId && item.typeId);

  if (categorized.length) {
    const categories = new Map<string, typeof categorized>();
    categorized.forEach((item) => {
      const key = `${item.descriptionCategoryId}:${item.typeId}`;
      categories.set(key, [...(categories.get(key) ?? []), item]);
    });

    return [...categories.values()]
      .sort((a, b) => {
        const totals = (items: typeof categorized) => items.reduce(
          (total, item) => ({
            revenue: total.revenue + (sales.get(item.offerId)?.revenueRub ?? 0),
            quantity: total.quantity + (sales.get(item.offerId)?.quantity ?? 0),
            stock: total.stock + item.stock,
          }),
          { revenue: 0, quantity: 0, stock: 0 },
        );
        const left = totals(a);
        const right = totals(b);
        return right.revenue - left.revenue || right.quantity - left.quantity || right.stock - left.stock;
      })
      .map((items) => items[0]!)
      .map((item) => ({
        offerId: item.offerId,
        title: item.name!,
        publicSku: item.publicSku,
        quantity: sales.get(item.offerId)?.quantity ?? 0,
        revenueRub: sales.get(item.offerId)?.revenueRub ?? 0,
        descriptionCategoryId: item.descriptionCategoryId ?? null,
        typeId: item.typeId ?? null,
        categoryNameRu: null,
        categoryPathRu: [],
      }));
  }

  return pool
    .slice(0, 5)
    .map((item) => ({
      offerId: item.offerId,
      title: item.name!,
      publicSku: item.publicSku,
      quantity: sales.get(item.offerId)?.quantity ?? 0,
      revenueRub: sales.get(item.offerId)?.revenueRub ?? 0,
      descriptionCategoryId: item.descriptionCategoryId ?? null,
      typeId: item.typeId ?? null,
      categoryNameRu: null,
      categoryPathRu: [],
    }));
}

function competitorCategoryKey(value: {
  descriptionCategoryId?: number | null;
  typeId?: number | null;
}) {
  return value.descriptionCategoryId && value.typeId
    ? `${value.descriptionCategoryId}:${value.typeId}`
    : null;
}

function textField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function targetsWithoutCompetitorEvidence(
  targets: OzonCompetitorTarget[],
  results: Pick<OzonCategoryCompetitorResult, "target" | "competitors">[],
) {
  const covered = new Set(results.flatMap((result) => {
    const key = result.competitors.length ? competitorCategoryKey(result.target) : null;
    return key ? [key] : [];
  }));
  return targets.filter((target) => {
    const key = competitorCategoryKey(target);
    return !key || !covered.has(key);
  });
}

export function summarizeCompetitorEvidence(params: {
  targets: OzonCompetitorTarget[];
  reports: unknown[];
  requestedPerCategory: number;
  warnings?: string[];
}) {
  const byCategory = new Map<string, {
    categoryKey: string;
    categoryName: string;
    competitorCount: number;
    cached: boolean;
    source: string;
    sufficient: boolean;
  }>();
  params.reports.forEach((report) => {
    const item = record(report);
    const target = record(item.target);
    const key = competitorCategoryKey({
      descriptionCategoryId: Number(target.descriptionCategoryId) || null,
      typeId: Number(target.typeId) || null,
    });
    if (!key) return;
    const competitors = Array.isArray(item.competitors) ? item.competitors : [];
    byCategory.set(key, {
      categoryKey: key,
      categoryName:
        textField(record(item.category).name) ??
        textField(target.categoryNameRu) ??
        textField(target.title) ??
        key,
      competitorCount: competitors.length,
      cached: item.cached === true,
      source: textField(item.source) ?? "unknown",
      sufficient: competitors.length >= params.requestedPerCategory,
    });
  });

  const categories = params.targets.map((target) => {
    const key = competitorCategoryKey(target) ?? `${target.offerId}:uncategorized`;
    return byCategory.get(key) ?? {
      categoryKey: key,
      categoryName: target.categoryNameRu ?? target.title,
      competitorCount: 0,
      cached: false,
      source: "none",
      sufficient: false,
    };
  });
  const insufficient = categories.filter((category) => !category.sufficient);
  const warningTexts = params.warnings ?? [];
  return {
    requestedPerCategory: params.requestedPerCategory,
    categoryCount: categories.length,
    coveredCategoryCount: categories.filter((category) => category.competitorCount > 0).length,
    sufficientCategoryCount: categories.filter((category) => category.sufficient).length,
    insufficientCategoryCount: insufficient.length,
    competitorCount: categories.reduce((total, category) => total + category.competitorCount, 0),
    reusedCacheCount: categories.filter((category) => category.cached).length,
    hasCrawlerBlocked: warningTexts.some((warning) => /403|HTTP|采集失败|扫描失败|cookie|代理|proxy/i.test(warning)),
    hasSearchFallbackFailure: warningTexts.some((warning) => /Tavily|搜索索引.*失败|fetch failed/i.test(warning)),
    categories,
    insufficientCategories: insufficient,
    warnings: warningTexts.slice(0, 20),
  };
}

export function selectCompetitorDiagnosisTargets(
  summary: OzonAnalyticsSummary,
  representatives: OzonCompetitorTarget[],
) {
  const representativeByCategory = new Map(
    representatives.flatMap((representative) => {
      const key = competitorCategoryKey(representative);
      return key ? [[key, representative] as const] : [];
    }),
  );

  return summary.products.flatMap((product) => {
    if (product.archived || !product.name) return [];
    const key = competitorCategoryKey(product);
    const representative = key ? representativeByCategory.get(key) : null;
    if (!representative) return [];
    return [{
      offerId: product.offerId,
      title: product.name,
      publicSku: product.publicSku,
      quantity: 0,
      revenueRub: 0,
      descriptionCategoryId: product.descriptionCategoryId,
      typeId: product.typeId,
      categoryNameRu: representative.categoryNameRu ?? null,
      categoryPathRu: representative.categoryPathRu ?? [],
    }];
  });
}

function positiveNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function categoryNodeName(node: CategoryNode) {
  return String(node.type_name ?? node.category_name ?? node.title ?? node.name ?? "").trim();
}

export function attachCompetitorCategoryLabels(
  tree: CategoryNode[],
  targets: OzonCompetitorTarget[],
) {
  const labels = new Map<string, { name: string; path: string[] }>();
  const visit = (node: CategoryNode, path: string[], inheritedCategoryId: number | null) => {
    const name = categoryNodeName(node);
    const nextPath = name ? [...path, name] : path;
    const categoryId = positiveNumber(
      node.description_category_id,
      node.category_id,
      node.id,
    ) ?? inheritedCategoryId;
    const typeId = positiveNumber(node.type_id);
    if (categoryId && typeId && name) {
      labels.set(`${categoryId}:${typeId}`, { name, path: nextPath });
    }
    (node.children ?? []).forEach((child) => visit(child, nextPath, categoryId));
  };
  tree.forEach((node) => visit(node, [], null));

  return targets.map((target) => {
    const key = `${target.descriptionCategoryId ?? 0}:${target.typeId ?? 0}`;
    const label = labels.get(key);
    return {
      ...target,
      categoryNameRu: label?.name ?? null,
      categoryPathRu: label?.path ?? [],
    };
  });
}

async function resolveStore(tenantId: string, storeId?: string | null) {
  const requestedStoreId = textField(storeId);
  const store = await prisma.store.findFirst({
    where: { tenantId, ...(requestedStoreId && !["null", "undefined"].includes(requestedStoreId.toLowerCase()) ? { id: requestedStoreId } : {}) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, ozonClientId: true, ozonApiKey: true },
  });
  if (!store) throw new Error("ozon_store_not_found");
  if (!store.ozonClientId || !store.ozonApiKey) throw new Error("ozon_store_not_configured");
  return store;
}

function clientFor(store: { ozonClientId: string; ozonApiKey: string }) {
  return new OzonClient({
    clientId: store.ozonClientId,
    apiKey: decryptSecret(store.ozonApiKey),
    baseUrl: env.ozonApiBase,
    enableRealSubmit: false,
  });
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function financeTransactions(client: OzonClient, from: Date, to: Date) {
  const transactions: OzonFinanceTransaction[] = [];
  for (let page = 1; page <= 20; page++) {
    const result = await client.listFinanceTransactions({
      filter: {
        date: { from: from.toISOString(), to: to.toISOString() },
        transaction_type: "all",
      },
      page,
      page_size: 1000,
    });
    transactions.push(...(result.operations ?? []));
    if (page >= (result.page_count || 1)) break;
  }
  return transactions;
}

export async function diagnoseOzonStore(params: {
  tenantId: string;
  storeId?: string | null;
}) {
  const store = await resolveStore(params.tenantId, params.storeId);
  const client = clientFor(store);
  const now = new Date();
  const currentFrom = addDays(now, -29);
  const previousTo = new Date(currentFrom.getTime() - 1);
  const previousFrom = addDays(currentFrom, -30);
  let financeWarning: string | null = null;
  const [current, previous, transactions] = await Promise.all([
    getOzonAnalyticsSummary({ client, since: currentFrom, to: now }),
    getOzonAnalyticsSummary({ client, since: previousFrom, to: previousTo }),
    financeTransactions(client, currentFrom, now).catch((error) => {
      financeWarning = `Ozon 财务流水读取失败：${error instanceof Error ? error.message : String(error)}`;
      return [];
    }),
  ]);
  const diagnosis = buildStoreDiagnosis({
    current,
    previous,
    finance: summarizeFinanceTransactions(transactions),
  });
  let ratingWarning: string | null = null;
  const skus = current.products
    .map((product) => product.publicSku)
    .filter((sku): sku is string => Boolean(sku));
  const ratings = (
    await Promise.all(
      Array.from({ length: Math.ceil(skus.length / 100) }, (_, index) =>
        client.getProductRatings(skus.slice(index * 100, index * 100 + 100)),
      ),
    ).catch((error) => {
      ratingWarning = `Ozon 商品内容评分读取失败：${error instanceof Error ? error.message : String(error)}`;
      return [];
    })
  ).flat();
  return {
    store: { id: store.id, name: store.name },
    ...diagnosis,
    lowContentRatingProducts: lowContentRatingProducts(current.products, ratings),
    warnings: [
      ...diagnosis.warnings,
      ...(financeWarning ? [financeWarning] : []),
      ...(ratingWarning ? [ratingWarning] : []),
    ],
    financeDataAvailable: transactions.length > 0,
    contentRatingDataAvailable: ratings.length > 0,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const COMPETITOR_DETAIL_SCOPE = "category_search_index_attributes_description_v3";

function cachedPublicProduct(value: unknown): OzonPublicProduct | null {
  const product = record(value);
  const attributes = record(product.attributes);
  const nullableNumber = (item: unknown) => item === null || (typeof item === "number" && Number.isFinite(item));
  const nullableString = (item: unknown) => item === null || typeof item === "string";
  return typeof product.sku === "string" &&
    typeof product.url === "string" &&
    typeof product.title === "string" &&
    nullableNumber(product.priceRub) &&
    nullableNumber(product.oldPriceRub) &&
    nullableNumber(product.rating) &&
    nullableNumber(product.reviewCount) &&
    nullableString(product.sellerName) &&
    nullableString(product.description) &&
    Array.isArray(product.imageUrls) && product.imageUrls.every((item) => typeof item === "string") &&
    product.attributes !== null && typeof product.attributes === "object" && !Array.isArray(product.attributes) &&
    Object.values(attributes).every((item) => typeof item === "string") &&
    Array.isArray(product.reviews)
    ? product as OzonPublicProduct
    : null;
}

export function cachedCompetitorReport(value: unknown, minimumCompetitors = 1) {
  const payload = record(value);
  const report = ["ozon_search_index", "ozon_http_crawler"].includes(String(payload.source)) &&
    payload.detailScope === COMPETITOR_DETAIL_SCOPE &&
    Array.isArray(payload.competitors) &&
    payload.competitors.length > 0 &&
    Boolean(record(payload.category).url)
    ? payload
    : null;
  if (!report) return null;

  const ownProduct = cachedPublicProduct(report.ownProduct);
  const competitors = (report.competitors as unknown[]).map(cachedPublicProduct);
  if (!ownProduct || competitors.some((product) => !product)) return null;
  const target = record(report.target);
  const usableCompetitors = uniqueUsableIndexedCompetitors(
    competitors as OzonPublicProduct[],
    target ? target as OzonCompetitorTarget : null,
  );
  if (!usableCompetitors.length) return null;
  const requestedCount = Number(report.competitorsPerCategory);
  if (
    usableCompetitors.length < minimumCompetitors &&
    (!Number.isInteger(requestedCount) || requestedCount < minimumCompetitors)
  ) return null;
  return {
    ...report,
    competitors: usableCompetitors,
    benchmarks: buildCompetitorBenchmarks(ownProduct, usableCompetitors),
  };
}

export function countUniqueCompetitors(reports: unknown[]) {
  return new Set(reports.flatMap((report) => {
    const competitors = record(report).competitors;
    return Array.isArray(competitors)
      ? competitors.map(cachedPublicProduct).filter((item): item is OzonPublicProduct => Boolean(item))
        .filter((item) => Object.values(item.attributes).some((value) => value.trim()) || Boolean(item.description?.trim()))
        .map((item) => item.sku)
      : [];
  })).size;
}

function words(value: string | null | undefined) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .match(/[\p{L}\p{N}#]+/gu)
    ?.filter((word) => word.length >= 4 && !/^\d+$/.test(word)) ?? [];
}

function topTerms(values: string[], limit = 10) {
  const counts = new Map<string, number>();
  values.flatMap(words).forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function medianNullable(values: Array<number | null>) {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function descriptionSummary(value: string | null | undefined) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 180) : null;
}

export async function buildCompetitorContentDiagnosis(reports: unknown[]) {
  const samples = reports.flatMap((report) => {
    const item = record(report);
    const target = record(item.target);
    const ownProduct = cachedPublicProduct(item.ownProduct);
    const competitors = Array.isArray(item.competitors)
      ? item.competitors.map(cachedPublicProduct).filter((product): product is OzonPublicProduct => Boolean(product))
      : [];
    if (!competitors.length) return [];
    const category = record(item.category);
    const titleTerms = topTerms(competitors.map((product) => product.title), 8);
    const descriptionTerms = topTerms(competitors.map((product) => product.description ?? ""), 8);
    return [{
      offerId: textField(target.offerId) ?? ownProduct?.sku ?? null,
      categoryName: textField(category.name) ?? textField(target.categoryNameRu) ?? textField(target.title),
      own: ownProduct ? {
        title: ownProduct.title,
        imageUrl: ownProduct.imageUrls[0] ?? null,
        imageCount: ownProduct.imageUrls.length,
        priceRub: ownProduct.priceRub,
        rating: ownProduct.rating,
        reviewCount: ownProduct.reviewCount,
        description: descriptionSummary(ownProduct.description),
      } : {
        title: textField(target.title),
        imageUrl: null,
        imageCount: 0,
        priceRub: null,
        rating: null,
        reviewCount: null,
        description: null,
      },
      competitors: competitors.slice(0, 6).map((product) => ({
        sku: product.sku,
        url: product.url,
        title: product.title,
        imageUrl: product.imageUrls[0] ?? null,
        imageCount: product.imageUrls.length,
        priceRub: product.priceRub,
        rating: product.rating,
        reviewCount: product.reviewCount,
        categoryPosition: product.categoryPosition ?? null,
        description: descriptionSummary(product.description),
      })),
      comparison: {
        title: {
          ownLength: ownProduct?.title.length ?? textField(target.title)?.length ?? null,
          competitorMedianLength: medianNullable(competitors.map((product) => product.title.length)),
          frequentTerms: titleTerms,
        },
        mainImage: {
          ownImageCount: ownProduct?.imageUrls.length ?? 0,
          competitorMedianImageCount: medianNullable(competitors.map((product) => product.imageUrls.length)),
        },
        price: {
          ownRub: ownProduct?.priceRub ?? null,
          competitorMedianRub: medianNullable(competitors.map((product) => product.priceRub)),
        },
        heat: {
          ownRating: ownProduct?.rating ?? null,
          ownReviewCount: ownProduct?.reviewCount ?? null,
          competitorMedianRating: medianNullable(competitors.map((product) => product.rating)),
          competitorMedianReviewCount: medianNullable(competitors.map((product) => product.reviewCount)),
          note: "Ozon 未返回真实销量；这里用评分、评价数和搜索位置作为热度代理。",
        },
        themes: {
          titleTerms,
          descriptionTerms,
        },
        description: {
          ownAvailable: Boolean(ownProduct?.description),
          competitorAvailableCount: competitors.filter((product) => product.description).length,
          samples: competitors.flatMap((product) =>
            product.description ? [{ sku: product.sku, text: descriptionSummary(product.description) }] : [],
          ).slice(0, 3),
        },
      },
    }];
  });

  const first = samples[0];
  const vision = first
    ? await analyzeProductImagesWithVision([
        { label: `自家 ${first.offerId ?? ""}`.trim(), imageUrl: first.own.imageUrl },
        ...first.competitors.slice(0, 3).map((item, index) => ({
          label: `竞品${index + 1}`,
          imageUrl: item.imageUrl,
        })),
      ])
    : { enabled: false, model: "", analyses: [], warning: "没有可分析竞品图片。" };

  return {
    kind: "competitor_content_diagnosis",
    heatProxyNotice: "Ozon 未返回真实销量；系统使用评分、评价数和搜索位置作为热度代理。",
    samples,
    vision,
  };
}

export function buildCompetitorBatchProposal(params: {
  storeId: string;
  reportIds: string[];
  productRecommendations: ProductAttributeRecommendationResult[];
}) {
  const selected = params.productRecommendations
    .filter((item) => item.categoryMatches && item.actionableCount > 0 && item.actionAttributes)
    .slice(0, 50);
  if (!selected.length) return null;
  const recommendations = selected.flatMap((product) =>
    product.recommendations
      .filter((item) => item.status === "ADD")
      .map((item) => ({ offerId: product.offerId, ...item })),
  );
  return {
    type: "BULK_PRODUCT_UPDATE" as const,
    title: `竞品属性经验批量优化（${selected.length} 个商品）`,
    rationale: `仅包含有自家商品文字证据并已映射到 Ozon 官方属性的 ${recommendations.length} 条补充建议，确认后批量执行。`,
    riskLevel: "MEDIUM" as const,
    storeId: params.storeId,
    payload: {
      agentVersion: "ozon_content_v1",
      source: "competitor_attribute_playbook",
      reportIds: params.reportIds,
      recommendations,
      items: selected.map((product) => ({
        type: "UPDATE_ATTRIBUTES",
        offerId: product.offerId,
        productId: product.productId,
        attributes: product.actionAttributes,
      })),
    },
  };
}

export function summarizeProductRecommendations(
  products: ProductAttributeRecommendationResult[],
) {
  const statusCounts = {
    COMPLETE: 0,
    ADD: 0,
    NEEDS_CONFIRMATION: 0,
    UNMAPPED: 0,
  };
  products.forEach((product) => {
    product.recommendations.forEach((recommendation) => {
      statusCounts[recommendation.status] += 1;
    });
  });
  const actionable = products.filter((product) => product.actionableCount > 0);
  return {
    productCount: products.length,
    actionableProductCount: actionable.length,
    needsConfirmationProductCount: products.filter((product) =>
      product.recommendations.some((item) => item.status === "NEEDS_CONFIRMATION"),
    ).length,
    statusCounts,
    actionableProducts: actionable.slice(0, 50).map((product) => ({
      offerId: product.offerId,
      categoryKey: product.categoryKey,
      additions: product.recommendations
        .filter((item) => item.status === "ADD")
        .map((item) => ({
          attribute: item.ozonNameRu ?? item.competitorNameRu,
          value: item.suggestedValue,
          evidenceUrls: item.evidenceUrls,
        })),
    })),
  };
}

function mergedProductInfo(
  info: OzonProductInfoItem | undefined,
  attributes: OzonProductInfoItem | undefined,
): OzonProductInfoItem | null {
  if (!info && !attributes) return null;
  return {
    ...(attributes ?? {}),
    ...(info ?? {}),
    attributes: attributes?.attributes ?? info?.attributes ?? [],
    description: attributes?.description ?? info?.description,
    description_category_id:
      attributes?.description_category_id ?? info?.description_category_id,
    type_id: attributes?.type_id ?? info?.type_id,
  };
}

async function buildCompetitorPlaybooks(params: {
  client: OzonClient;
  tenantId: string;
  userId: string;
  products: OzonCompetitorTarget[];
  reports: unknown[];
  refreshEvidence: boolean;
  capturedAt: Date;
  minimumCompetitors: number;
}) {
  if (!params.products.length) {
    return { playbookReports: [], productRecommendations: [], warnings: [] as string[] };
  }
  const offerIds = params.products.map((target) => target.offerId);
  let infoItems: OzonProductInfoItem[] = [];
  let attributeItems: OzonProductInfoItem[] = [];
  const warnings: string[] = [];
  try {
    const batches = Array.from(
      { length: Math.ceil(offerIds.length / 100) },
      (_, index) => offerIds.slice(index * 100, index * 100 + 100),
    );
    const productBatches = await Promise.all(batches.map(async (batch) => Promise.all([
      params.client.getProductInfoList({ offerIds: batch }),
      params.client.getProductInfoAttributes({ offerIds: batch }),
    ])));
    infoItems = productBatches.flatMap(([items]) => items);
    attributeItems = productBatches.flatMap(([, items]) => items);
  } catch (error) {
    warnings.push(`自家商品属性读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const infoByOffer = new Map(infoItems.map((item) => [item.offer_id, item]));
  const attributesByOffer = new Map(attributeItems.map((item) => [item.offer_id, item]));
  const reportByCategory = new Map(params.reports.flatMap((report) => {
    const item = record(report);
    const target = record(item.target);
    const key = competitorCategoryKey({
      descriptionCategoryId: Number(target.descriptionCategoryId) || null,
      typeId: Number(target.typeId) || null,
    });
    return key ? [[key, item] as const] : [];
  }));
  const groups = new Map<string, {
    categoryName: string;
    products: OzonProductInfoItem[];
    competitors: Map<string, OzonPublicProduct>;
  }>();

  params.reports.forEach((report) => {
    const item = record(report);
    const target = record(item.target);
    if (!target) return;
    const key = competitorCategoryKey({
      descriptionCategoryId: Number(target.descriptionCategoryId) || null,
      typeId: Number(target.typeId) || null,
    });
    if (!key) return;
    const categoryName = String(record(item.category).name ?? target.categoryNameRu ?? target.title ?? key);
    const group = groups.get(key) ?? {
      categoryName,
      products: [],
      competitors: new Map<string, OzonPublicProduct>(),
    };
    const competitors = Array.isArray(item.competitors) ? item.competitors : [];
    competitors.map(cachedPublicProduct).filter((product): product is OzonPublicProduct => Boolean(product))
      .filter((product) => isUsableCompetitorEvidence(product, target as OzonCompetitorTarget))
      .forEach((product) => group.competitors.set(product.url, product));
    groups.set(key, group);
  });

  params.products.forEach((target) => {
    const product = mergedProductInfo(
      infoByOffer.get(target.offerId),
      attributesByOffer.get(target.offerId),
    );
    const categoryId = product?.description_category_id;
    const typeId = product?.type_id;
    if (!product || !categoryId || !typeId) {
      warnings.push(`${target.offerId}：Ozon 未返回类目 ID 或类型 ID，无法建立官方属性映射`);
      return;
    }
    const report = reportByCategory.get(`${categoryId}:${typeId}`);
    const categoryName = target.categoryNameRu ?? String(record(report?.category).name ?? target.title);
    const key = `${categoryId}:${typeId}`;
    const group = groups.get(key) ?? {
      categoryName,
      products: [],
      competitors: new Map<string, OzonPublicProduct>(),
    };
    const competitors = Array.isArray(report?.competitors) ? report.competitors : [];
    competitors.map(cachedPublicProduct).filter((item): item is OzonPublicProduct => Boolean(item))
      .filter((item) => isUsableCompetitorEvidence(item, target))
      .forEach((item) => group.competitors.set(item.url, item));
    group.products.push(product);
    groups.set(key, group);
  });

  const playbookReports: Array<{ reportId: string; playbook: NonNullable<ReturnType<typeof parseCategoryAttributePlaybook>> }> = [];
  const productRecommendations: ProductAttributeRecommendationResult[] = [];
  for (const [categoryKey, group] of groups) {
    try {
      const [descriptionCategoryId, typeId] = categoryKey.split(":").map(Number);
      const title = `类目属性经验 v4：${categoryKey}`;
      const cached = params.refreshEvidence ? null : await prisma.competitorContentReport.findFirst({
        where: {
          tenantId: params.tenantId,
          title,
        },
        orderBy: { createdAt: "desc" },
      });
      let playbook = parseCategoryAttributePlaybook(cached?.reportJson);
      if (playbook && playbook.sampleSize < params.minimumCompetitors) {
        warnings.push(`${group.categoryName}：缓存类目经验样本 ${playbook.sampleSize}/${params.minimumCompetitors}，已忽略`);
        playbook = null;
      }
      let reportId = cached?.id ?? null;
      if (!playbook) {
        if (!group.competitors.size) {
          warnings.push(`${group.categoryName}：没有有效竞品属性样本，未生成类目经验`);
          continue;
        }
        if (group.competitors.size < params.minimumCompetitors) {
          warnings.push(`${group.categoryName}：有效竞品样本 ${group.competitors.size}/${params.minimumCompetitors}，未生成类目经验`);
          continue;
        }
        const categoryAttributes = await params.client
          .getCategoryAttributes(descriptionCategoryId!, typeId!)
          .catch((error) => {
            warnings.push(`${group.categoryName}：Ozon 官方属性读取失败，已生成未映射竞品经验：${error instanceof Error ? error.message : String(error)}`);
            return [];
          });
        const competitors = [...group.competitors.values()].map((item) => ({
          url: item.url,
          attributes: item.attributes,
          description: item.description,
        }));
        const draft = buildCategoryAttributePlaybook({
          descriptionCategoryId: descriptionCategoryId!,
          typeId: typeId!,
          categoryName: group.categoryName,
          categoryAttributes,
          competitors,
          capturedAt: params.capturedAt.toISOString(),
        });
        const dictionaryEntries = await Promise.all(draft.attributes.flatMap((attribute) =>
          attribute.ozonAttributeId && attribute.dictionaryId
            ? [params.client.getAttributeValues(
                descriptionCategoryId!,
                typeId!,
                attribute.ozonAttributeId,
              ).then((values) => [attribute.ozonAttributeId!, values] as const).catch(() => [
                attribute.ozonAttributeId!,
                [] as Array<{ id: number; value: string }>,
              ] as const)]
            : [],
        ));
        playbook = buildCategoryAttributePlaybook({
          descriptionCategoryId: descriptionCategoryId!,
          typeId: typeId!,
          categoryName: group.categoryName,
          categoryAttributes,
          competitors,
          dictionaryValues: new Map(dictionaryEntries),
          capturedAt: params.capturedAt.toISOString(),
        });
        const saved = await prisma.competitorContentReport.create({
          data: {
            tenantId: params.tenantId,
            title,
            createdBy: params.userId,
            reportJson: playbook as never,
          },
        });
        reportId = saved.id;
      }
      if (!reportId) continue;
      playbookReports.push({ reportId, playbook });
      group.products.forEach((product) => {
        productRecommendations.push(buildProductAttributeRecommendations({ playbook, product }));
      });
    } catch (error) {
      warnings.push(`${group.categoryName}：类目属性经验生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { playbookReports, productRecommendations, warnings };
}

export async function analyzeOzonCompetitors(params: {
  tenantId: string;
  userId: string;
  storeId?: string | null;
  competitorsPerCategory: number;
  refreshEvidence?: boolean;
}) {
  const store = await resolveStore(params.tenantId, params.storeId);
  const client = clientFor(store);
  const now = new Date();
  const summary = await getOzonAnalyticsSummary({
    client,
    since: addDays(now, -29),
    to: now,
  });
  let targets: OzonCompetitorTarget[] = selectCompetitorTargets(summary);
  const warnings = [...(summary.warnings ?? [])];
  if (targets.length) {
    try {
      targets = attachCompetitorCategoryLabels(await client.getCategoryTree(), targets);
    } catch (error) {
      warnings.push(`Ozon 官方类目读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const reports: unknown[] = [];
  const pending: OzonCompetitorTarget[] = [];
  const cachedReports = params.refreshEvidence ? [] : await prisma.competitorContentReport.findMany({
    where: {
      tenantId: params.tenantId,
      title: { startsWith: "竞品分析：" },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  for (const target of targets) {
    const targetKey = competitorCategoryKey(target);
    const cachedReport = cachedReports.find(
      (item) => {
        const report = record(item.reportJson);
        const reportTarget = record(report.target);
        return report.storeId === store.id &&
          targetKey === competitorCategoryKey({
            descriptionCategoryId: Number(reportTarget.descriptionCategoryId) || null,
            typeId: Number(reportTarget.typeId) || null,
          }) &&
          cachedCompetitorReport(report, params.competitorsPerCategory);
      },
    );
    const reused = cachedReport
      ? cachedCompetitorReport(cachedReport.reportJson, params.competitorsPerCategory)
      : null;
    if (reused) {
      reports.push({ ...reused, cached: true });
      continue;
    }
    pending.push(target);
  }

  let crawled: OzonCategoryCompetitorResult[] = [];
  const defaultEvidenceSource = ozonCrawlerConfigured() ? "ozon_http_crawler" : "ozon_search_index";
  const sourceByCategory = new Map<string, "ozon_http_crawler" | "ozon_search_index">();
  const shouldCollectMissingEvidence = pending.length && (
    params.refreshEvidence ||
    ozonCrawlerConfigured() ||
    Boolean(env.tavilyApiKey)
  );
  if (shouldCollectMissingEvidence) {
    const ownSkus = new Set(
      summary.products.map((item) => item.publicSku).filter((sku): sku is string => Boolean(sku)),
    );
    const searchIndexed = (searchTargets: OzonCompetitorTarget[]) => searchOzonIndexedCompetitors({
      apiKey: env.tavilyApiKey,
      targets: searchTargets,
      ownSkus,
      limitPerProduct: params.competitorsPerCategory,
    });
    if (ozonCrawlerConfigured()) {
      try {
        crawled = await crawlOzonCompetitorsWithProcess({
          requestId: `${store.id}-${now.getTime()}`,
          targets: pending,
          ownSkus,
          limitPerCategory: params.competitorsPerCategory,
        });
        crawled.forEach((result) => {
          const key = competitorCategoryKey(result.target);
          if (key) sourceByCategory.set(key, "ozon_http_crawler");
        });
      } catch (error) {
        warnings.push(`Ozon HTTP 采集失败：${error instanceof Error ? error.message : String(error)}`);
      }
      const fallbackTargets = targetsWithoutCompetitorEvidence(pending, crawled);
      if (fallbackTargets.length && env.tavilyApiKey) {
        try {
          const fallback = await searchIndexed(fallbackTargets);
          const fallbackKeys = new Set(fallbackTargets.map(competitorCategoryKey).filter(Boolean));
          crawled = [
            ...crawled.filter((result) => !fallbackKeys.has(competitorCategoryKey(result.target))),
            ...fallback,
          ];
          fallback.forEach((result) => {
            const key = competitorCategoryKey(result.target);
            if (key) sourceByCategory.set(key, "ozon_search_index");
          });
          warnings.push(`${fallbackTargets.length} 个本地采集失败类目已回退使用 Tavily 搜索索引证据`);
        } catch (fallbackError) {
          warnings.push(`Tavily 回退采集失败：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        }
      }
    } else {
      try {
        crawled = await searchIndexed(pending);
        crawled.forEach((result) => {
          const key = competitorCategoryKey(result.target);
          if (key) sourceByCategory.set(key, "ozon_search_index");
        });
      } catch (error) {
        warnings.push(`Ozon 搜索索引采集失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else if (pending.length) {
    warnings.push(`${pending.length} 个类目没有历史竞品证据，且没有配置 Ozon 采集器或 Tavily。`);
  }

  for (const result of crawled) {
    const resultSource = sourceByCategory.get(competitorCategoryKey(result.target) ?? "") ?? defaultEvidenceSource;
    warnings.push(...result.warnings.map((warning) => `${result.target.offerId}：${warning}`));
    const competitors = result.competitors;
    if (!result.category || !competitors.length) {
      reports.push({ ...result, cached: false });
      continue;
    }
    const competitorIds = [];
    for (const competitor of competitors) {
      const saved = await prisma.competitorProduct.upsert({
        where: { tenantId_url: { tenantId: params.tenantId, url: competitor.url } },
        update: {
          title: competitor.title,
          sku: competitor.sku,
          sellerName: competitor.sellerName,
          priceText: competitor.priceRub === null ? null : String(competitor.priceRub),
          rating: competitor.rating,
          reviewCount: competitor.reviewCount,
          imageUrlsJson: competitor.imageUrls as never,
          attributesJson: competitor.attributes as never,
          description: competitor.description,
          rawJson: { source: resultSource, category: result.category } as never,
          lastCapturedAt: now,
        },
        create: {
          tenantId: params.tenantId,
          url: competitor.url,
          sku: competitor.sku,
          title: competitor.title,
          sellerName: competitor.sellerName,
          priceText: competitor.priceRub === null ? null : String(competitor.priceRub),
          rating: competitor.rating,
          reviewCount: competitor.reviewCount,
          imageUrlsJson: competitor.imageUrls as never,
          attributesJson: competitor.attributes as never,
          description: competitor.description,
          rawJson: { source: resultSource, category: result.category } as never,
          lastCapturedAt: now,
        },
      });
      competitorIds.push(saved.id);
      await prisma.competitorProductSnapshot.create({
        data: {
          tenantId: params.tenantId,
          productId: saved.id,
          title: competitor.title,
          priceText: competitor.priceRub === null ? null : String(competitor.priceRub),
          rating: competitor.rating,
          reviewCount: competitor.reviewCount,
          imageUrlsJson: competitor.imageUrls as never,
          attributesJson: competitor.attributes as never,
          description: competitor.description,
          rawJson: competitor as never,
          capturedAt: now,
        },
      });
    }
    await prisma.competitorContentReport.create({
      data: {
        tenantId: params.tenantId,
        competitorProductId: competitorIds[0],
        ozonOfferId: result.target.offerId,
        title: `竞品分析：${result.target.title}`,
        createdBy: params.userId,
        reportJson: {
          source: resultSource,
          detailScope: COMPETITOR_DETAIL_SCOPE,
          competitorsPerCategory: params.competitorsPerCategory,
          storeId: store.id,
          target: result.target,
          category: result.category,
          ownProduct: result.ownProduct,
          competitorProductIds: competitorIds,
          competitors,
          benchmarks: result.benchmarks,
          capturedAt: now.toISOString(),
        } as never,
      },
    });
    reports.push({
      source: resultSource,
      detailScope: COMPETITOR_DETAIL_SCOPE,
      competitorsPerCategory: params.competitorsPerCategory,
      target: result.target,
      category: result.category,
      ownProduct: result.ownProduct,
      competitors,
      benchmarks: result.benchmarks,
      cached: false,
    });
  }

  const playbooks = await buildCompetitorPlaybooks({
    client,
    tenantId: params.tenantId,
    userId: params.userId,
    products: selectCompetitorDiagnosisTargets(summary, targets),
    reports,
    refreshEvidence: Boolean(params.refreshEvidence),
    capturedAt: now,
    minimumCompetitors: params.competitorsPerCategory,
  });
  const contentDiagnosis = await buildCompetitorContentDiagnosis(reports);

  const reportSources = new Set(reports.map((report) => String(record(report).source)));
  const source = reportSources.has("ozon_http_crawler") && reportSources.has("ozon_search_index")
    ? "本地 Ozon 纯 HTTP 采集器 + Tavily 搜索索引回退"
    : reportSources.has("ozon_http_crawler")
      ? "本地 Ozon 纯 HTTP 采集器"
      : "Tavily / Ozon 搜索引擎收录页面";
  const combinedWarnings = [...warnings, ...playbooks.warnings];
  return {
    store: { id: store.id, name: store.name },
    periodDays: 30,
    competitorsPerCategory: params.competitorsPerCategory,
    source,
    capturedAt: now.toISOString(),
    reports,
    categoryPlaybooks: playbooks.playbookReports,
    contentDiagnosis,
    productRecommendations: playbooks.productRecommendations,
    analyzedProductCount: playbooks.productRecommendations.length,
    evidenceQuality: summarizeCompetitorEvidence({
      targets,
      reports,
      requestedPerCategory: params.competitorsPerCategory,
      warnings: combinedWarnings,
    }),
    warnings: combinedWarnings,
  };
}
