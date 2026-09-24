import { OzonApiError, type OzonClient } from "./client";
import type {
  OzonAnalyticsProduct,
  OzonAnalyticsSummary,
  OzonOrderSummary,
  OzonPostingItem,
  OzonProductInfoItem,
  OzonProductListItem,
  OzonProductStockItem,
} from "./types";

const LOW_STOCK_THRESHOLD = 5;

function toId(value: string | number | undefined | null): string {
  return value == null ? "" : String(value);
}

function toMoney(value: string | number | undefined | null): number {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstImage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const image = value.find((item) => typeof item === "string" && item.trim());
    return typeof image === "string" ? image : null;
  }
  return null;
}

function dayKey(value?: string): string {
  const d = value ? new Date(value) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return safe.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildDailyOrders(
  since: Date,
  to: Date,
  fbsPostings: OzonPostingItem[],
  fboPostings: OzonPostingItem[],
): OzonOrderSummary["dailyOrders"] {
  const byDate = new Map<string, { date: string; fbs: number; fbo: number }>();
  for (let d = new Date(since); d <= to; d = addDays(d, 1)) {
    const key = d.toISOString().slice(0, 10);
    byDate.set(key, { date: key, fbs: 0, fbo: 0 });
  }
  for (const posting of fbsPostings) {
    const key = dayKey(posting.in_process_at ?? posting.shipment_date);
    const item = byDate.get(key) ?? { date: key, fbs: 0, fbo: 0 };
    item.fbs += 1;
    byDate.set(key, item);
  }
  for (const posting of fboPostings) {
    const key = dayKey(posting.in_process_at ?? posting.shipment_date);
    const item = byDate.get(key) ?? { date: key, fbs: 0, fbo: 0 };
    item.fbo += 1;
    byDate.set(key, item);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sumPostingRevenue(posting: OzonPostingItem): number {
  if (posting.financial_data?.products?.length) {
    return posting.financial_data.products.reduce((sum, p) => {
      const payout = toMoney(p.payout);
      if (payout > 0) return sum + payout;
      return sum + toMoney(p.price) * (p.quantity ?? 1);
    }, 0);
  }
  return (posting.products ?? []).reduce((sum, p) => {
    return sum + toMoney(p.price) * (p.quantity ?? 1);
  }, 0);
}

function summarizeOrders(
  since: Date,
  to: Date,
  fbsPostings: OzonPostingItem[],
  fboPostings: OzonPostingItem[],
): OzonOrderSummary {
  const postings = [...fbsPostings, ...fboPostings];
  const cancelledOrderCount = postings.filter((p) => p.status?.toLowerCase().includes("cancel")).length;
  const pendingShipmentCount = postings.filter((p) => {
    const status = p.status?.toLowerCase() ?? "";
    return status.includes("await") || status.includes("pending") || status.includes("arbitration");
  }).length;

  return {
    orderCount: postings.length,
    pendingShipmentCount,
    cancelledOrderCount,
    grossRevenueRub: postings.reduce((sum, p) => sum + sumPostingRevenue(p), 0),
    dailyOrders: buildDailyOrders(since, to, fbsPostings, fboPostings),
    topProducts: buildTopProducts(postings),
  };
}

function buildTopProducts(postings: OzonPostingItem[]): OzonOrderSummary["topProducts"] {
  const byOffer = new Map<string, { offerId: string; name: string | null; quantity: number; revenueRub: number }>();
  for (const posting of postings) {
    const financeProducts = posting.financial_data?.products ?? [];
    for (const [index, product] of (posting.products ?? []).entries()) {
      const finance = financeProducts[index];
      const offerId = product.offer_id ?? finance?.offer_id;
      if (!offerId) continue;
      const quantity = product.quantity ?? finance?.quantity ?? 1;
      const revenueRub = toMoney(finance?.payout) || toMoney(finance?.price || product.price) * quantity;
      const current = byOffer.get(offerId) ?? {
        offerId,
        name: product.name ?? finance?.name ?? null,
        quantity: 0,
        revenueRub: 0,
      };
      byOffer.set(offerId, {
        ...current,
        name: current.name ?? product.name ?? finance?.name ?? null,
        quantity: current.quantity + quantity,
        revenueRub: current.revenueRub + revenueRub,
      });
    }
  }
  return [...byOffer.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenueRub - a.revenueRub)
    .slice(0, 10);
}

function productKey(item: {
  product_id?: string | number;
  id?: string | number;
  offer_id?: string;
}): string {
  return toId(item.product_id ?? item.id ?? item.offer_id);
}

function normalizeProducts(
  listed: OzonProductListItem[],
  details: OzonProductInfoItem[],
  stocks: OzonProductStockItem[],
): OzonAnalyticsProduct[] {
  const detailByKey = new Map(details.map((item) => [productKey(item), item]));
  const stockByKey = new Map(stocks.map((item) => [productKey(item), item]));
  const keys = new Set<string>();

  for (const item of listed) keys.add(productKey(item));
  for (const item of details) keys.add(productKey(item));
  for (const item of stocks) keys.add(productKey(item));

  return [...keys]
    .filter(Boolean)
    .map((key) => {
      const base = listed.find((item) => productKey(item) === key);
      const detail = detailByKey.get(key);
      const stockItem = stockByKey.get(key);
      const stock = stockItem
        ? (stockItem.stocks ?? []).reduce((sum, s) => sum + (s.present ?? 0), 0)
        : null;
      const reservedStock = stockItem
        ? (stockItem.stocks ?? []).reduce((sum, s) => sum + (s.reserved ?? 0), 0)
        : null;
      const status = detail?.status?.state_name ?? detail?.status?.state ?? detail?.status?.status ?? base?.visibility ?? null;
      const archived = Boolean(detail?.archived ?? base?.archived);
      const visible = typeof detail?.visible === "boolean"
        ? detail.visible
        : typeof base?.visibility === "string"
          ? base.visibility === "VISIBLE"
          : null;

      return {
        productId: key,
        offerId: detail?.offer_id ?? stockItem?.offer_id ?? base?.offer_id ?? key,
        name: detail?.name ?? null,
        status,
        visible,
        archived,
        stock,
        reservedStock,
        priceRub: detail?.price ? toMoney(detail.price) : null,
        imageUrl: firstImage(detail?.primary_image) ?? firstImage(detail?.images) ?? null,
        publicSku: detail?.sources?.find((source) => source.sku)?.sku
          ? String(detail.sources.find((source) => source.sku)!.sku)
          : null,
        descriptionCategoryId: detail?.description_category_id ?? null,
        typeId: detail?.type_id ?? null,
      };
    })
    .sort((a, b) => (a.stock ?? Number.POSITIVE_INFINITY) - (b.stock ?? Number.POSITIVE_INFINITY));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function warningMessage(error: unknown): string {
  if (error instanceof OzonApiError) {
    return `${error.path} 返回 ${error.status}${error.code ? ` / ${error.code}` : ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function optionalOzonCall<T>(
  label: string,
  call: Promise<T>,
  fallback: T,
  warnings: string[],
): Promise<T> {
  try {
    return await call;
  } catch (error) {
    warnings.push(`${label}同步失败：${warningMessage(error)}`);
    return fallback;
  }
}

export async function getOzonAnalyticsSummary(params: {
  client: OzonClient;
  since: Date;
  to: Date;
}): Promise<OzonAnalyticsSummary> {
  const warnings: string[] = [];
  const productList = await params.client.listProducts(1000);
  const productIds = productList.items
    .map((item) => toId(item.product_id))
    .filter(Boolean);
  const offerIdsWithoutProductId = productList.items
    .filter((item) => !toId(item.product_id))
    .map((item) => toId(item.offer_id))
    .filter(Boolean);

  const detailRequests = [
    ...chunk(productIds, 100).map((ids) => ({ productIds: ids })),
    ...chunk(offerIdsWithoutProductId, 100).map((ids) => ({ offerIds: ids })),
  ];
  const details = (
    await Promise.all(
      detailRequests.map((request) =>
        optionalOzonCall(
          "商品详情",
          params.client.getProductInfoList(request),
          [],
          warnings,
        ),
      ),
    )
  ).flat();

  const stockRequests = [
    ...chunk(productIds, 1000).map((ids) => ({ productIds: ids, limit: ids.length })),
    ...chunk(offerIdsWithoutProductId, 1000).map((ids) => ({ offerIds: ids, limit: ids.length })),
  ];
  const stocks = (
    await Promise.all(
      stockRequests.map((request) =>
        optionalOzonCall("库存", params.client.getProductStocks(request), [], warnings),
      ),
    )
  ).flat();

  const [fbsPostings, fboPostings] = await Promise.all([
    optionalOzonCall(
      "FBS 订单",
      params.client.listFbsPostings({ since: params.since, to: params.to }),
      [],
      warnings,
    ),
    optionalOzonCall(
      "FBO 订单",
      params.client.listFboPostings({ since: params.since, to: params.to }),
      [],
      warnings,
    ),
  ]);

  const products = normalizeProducts(productList.items, details, stocks);
  const orderSummary = summarizeOrders(params.since, params.to, fbsPostings, fboPostings);
  const visibilityComplete = products.every((product) => product.visible !== null);
  const stockComplete = products.every((product) => product.stock !== null);

  return {
    productCount: productList.total ?? products.length,
    visibleProductCount: visibilityComplete
      ? products.filter((p) => p.visible && !p.archived).length
      : null,
    archivedProductCount: products.filter((p) => p.archived).length,
    totalStock: stockComplete
      ? products.reduce((sum, p) => sum + (p.stock ?? 0), 0)
      : null,
    lowStockCount: stockComplete
      ? products.filter((p) => (p.stock ?? 0) <= LOW_STOCK_THRESHOLD).length
      : null,
    fbsOrderCount: fbsPostings.length,
    fboOrderCount: fboPostings.length,
    pendingShipmentCount: orderSummary.pendingShipmentCount,
    cancelledOrderCount: orderSummary.cancelledOrderCount,
    grossRevenueRub: orderSummary.grossRevenueRub,
    dailyOrders: orderSummary.dailyOrders,
    topProducts: orderSummary.topProducts,
    products,
    warnings,
  };
}
