import { Prisma, decryptSecret, prisma } from "@saas/db";
import {
  getOzonAnalyticsSummary,
  OzonClient,
  type OzonAnalyticsSummary,
  type OzonFinanceTransaction,
} from "@saas/ozon";
import { env } from "@/lib/env";
import { createTavilyCompetitorSearchClient } from "./competitor-search";
import { getProfitGuardrails } from "./policy";

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

export function selectCompetitorTargets(summary: OzonAnalyticsSummary) {
  const top = summary.topProducts
    .filter((item) => item.offerId && item.name)
    .slice(0, 5)
    .map((item) => ({
      offerId: item.offerId,
      title: item.name!,
      quantity: item.quantity,
      revenueRub: item.revenueRub,
    }));
  if (top.length) return top;

  return summary.products
    .filter((item) => item.visible && !item.archived && item.stock > 0 && item.name)
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 5)
    .map((item) => ({
      offerId: item.offerId,
      title: item.name!,
      quantity: 0,
      revenueRub: 0,
    }));
}

async function resolveStore(tenantId: string, storeId?: string | null) {
  const store = await prisma.store.findFirst({
    where: { tenantId, ...(storeId ? { id: storeId } : {}) },
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
  return {
    store: { id: store.id, name: store.name },
    ...diagnosis,
    warnings: [...diagnosis.warnings, ...(financeWarning ? [financeWarning] : [])],
    financeDataAvailable: transactions.length > 0,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cachedCompetitors(value: unknown) {
  const payload = record(value);
  return payload.source === "tavily_ozon" && Array.isArray(payload.competitors)
    ? payload.competitors
    : null;
}

export async function analyzeOzonCompetitors(params: {
  tenantId: string;
  userId: string;
  storeId?: string | null;
}) {
  const store = await resolveStore(params.tenantId, params.storeId);
  const client = clientFor(store);
  const now = new Date();
  const summary = await getOzonAnalyticsSummary({
    client,
    since: addDays(now, -29),
    to: now,
  });
  if (!env.tavilyApiKey.trim()) throw new Error("TAVILY_API_KEY 未配置");
  const targets = selectCompetitorTargets(summary);
  const search = createTavilyCompetitorSearchClient({ apiKey: env.tavilyApiKey });
  const cacheAfter = new Date(
    now.getTime() - getProfitGuardrails().competitorCacheHours * 60 * 60 * 1000,
  );
  const reports = [];
  const warnings = [...(summary.warnings ?? [])];

  for (const target of targets) {
    const cached = await prisma.competitorContentReport.findMany({
      where: {
        tenantId: params.tenantId,
        ozonOfferId: target.offerId,
        createdAt: { gte: cacheAfter },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const cachedReport = cached.find(
      (item) => record(item.reportJson).storeId === store.id && cachedCompetitors(item.reportJson),
    );
    const reused = cachedReport ? cachedCompetitors(cachedReport.reportJson) : null;
    if (reused) {
      reports.push({ ownProduct: target, competitors: reused, cached: true });
      continue;
    }

    const ownProduct = summary.products.find((item) => item.offerId === target.offerId);
    let competitors;
    try {
      competitors = await search.search({
        title: target.title,
        offerId: target.offerId,
        sku: ownProduct?.productId,
      });
    } catch (error) {
      warnings.push(
        `${target.offerId} 竞品搜索失败：${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const competitorIds = [];
    for (const competitor of competitors) {
      const saved = await prisma.competitorProduct.upsert({
        where: { tenantId_url: { tenantId: params.tenantId, url: competitor.url } },
        update: {
          title: competitor.title,
          description: competitor.content,
          rawJson: { source: "tavily", score: competitor.score } as never,
          lastCapturedAt: now,
        },
        create: {
          tenantId: params.tenantId,
          url: competitor.url,
          title: competitor.title,
          description: competitor.content,
          rawJson: { source: "tavily", score: competitor.score } as never,
          lastCapturedAt: now,
        },
      });
      competitorIds.push(saved.id);
      await prisma.competitorProductSnapshot.create({
        data: {
          tenantId: params.tenantId,
          productId: saved.id,
          title: competitor.title,
          description: competitor.content,
          rawJson: competitor as never,
          capturedAt: now,
        },
      });
    }
    await prisma.competitorContentReport.create({
      data: {
        tenantId: params.tenantId,
        competitorProductId: competitorIds[0],
        ozonOfferId: target.offerId,
        title: `竞品分析：${target.title}`,
        createdBy: params.userId,
        reportJson: {
          source: "tavily_ozon",
          storeId: store.id,
          ownProduct: target,
          competitorProductIds: competitorIds,
          competitors,
          capturedAt: now.toISOString(),
        } as never,
      },
    });
    reports.push({ ownProduct: target, competitors, cached: false });
  }

  return {
    store: { id: store.id, name: store.name },
    periodDays: 30,
    source: "Tavily / Ozon 公开页面",
    capturedAt: now.toISOString(),
    reports,
    warnings,
  };
}
