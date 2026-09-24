import { Prisma } from "@prisma/client";
import { decryptSecret, prisma } from "@saas/db";
import {
  getOzonAnalyticsSummary,
  OzonApiError,
  OzonClient,
  type OzonAnalyticsSummary,
} from "@saas/ozon";
import { env } from "./env";

export type OzonAnalyticsView = {
  store: {
    id: string;
    name: string;
    isDefault: boolean;
  } | null;
  stores: Array<{
    id: string;
    name: string;
    isDefault: boolean;
  }>;
  latestSnapshot: {
    id: string;
    syncedAt: string;
    periodFrom: string;
    periodTo: string;
    productCount: number;
    visibleProductCount: number | null;
    archivedProductCount: number;
    totalStock: number | null;
    lowStockCount: number | null;
    fbsOrderCount: number | null;
    fboOrderCount: number | null;
    pendingShipmentCount: number | null;
    cancelledOrderCount: number | null;
    grossRevenueRub: string | null;
    orderDataStatus: NonNullable<OzonAnalyticsSummary["orderDataStatus"]>;
    orderAmountBasis: NonNullable<OzonAnalyticsSummary["orderAmountBasis"]> | null;
    dailyOrders: Array<{ date: string; fbs: number; fbo: number }>;
    topProducts: Array<{
      offerId: string;
      name: string | null;
      quantity: number;
      revenueRub: number;
    }>;
    error: string | null;
  } | null;
  products: Array<{
    id: string;
    productId: string;
    offerId: string;
    name: string | null;
    status: string | null;
    visible: boolean | null;
    archived: boolean;
    stock: number | null;
    reservedStock: number | null;
    priceRub: string | null;
    imageUrl: string | null;
    syncedAt: string;
  }>;
  localFunnel: {
    collected: number;
    productPool: number;
    drafts: number;
    compiledDrafts: number;
    submittedRuns: number;
  };
};

export type OzonSyncErrorView = {
  code: string;
  message: string;
  status: number;
  meta: Record<string, unknown>;
};

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function assertOzonClientId(clientId: string) {
  if (!/^[1-9]\d*$/.test(clientId.trim())) {
    throw new Error("invalid_ozon_client_id");
  }
}

function optionalStoreId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && !["null", "undefined"].includes(trimmed.toLowerCase()) ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableNumber(value: unknown, fallback: number) {
  return value === null ? null : typeof value === "number" ? value : fallback;
}

function orderDataStatus(value: unknown): NonNullable<OzonAnalyticsSummary["orderDataStatus"]> {
  const status = asRecord(value);
  const channel = (input: unknown) => {
    const item = asRecord(input);
    if (item.state === "complete") return { state: "complete" as const };
    if (item.state !== "failed") return { state: "unknown" as const };
    const errorKind = ["permission", "timeout", "network", "api", "unknown"].includes(String(item.errorKind))
      ? item.errorKind as "permission" | "timeout" | "network" | "api" | "unknown"
      : "unknown" as const;
    return { state: "failed" as const, errorKind };
  };
  return ["complete", "partial", "unavailable"].includes(String(status.state))
    ? {
        state: status.state as "complete" | "partial" | "unavailable",
        fbs: channel(status.fbs),
        fbo: channel(status.fbo),
      }
    : { state: "unknown", fbs: { state: "unknown" }, fbo: { state: "unknown" } };
}

export function formatOzonSyncError(error: unknown): OzonSyncErrorView {
  if (error instanceof OzonApiError) {
    if (error.status === 400 && /Client-Id/i.test(error.message)) {
      return {
        code: "invalid_ozon_client_id",
        message: "Ozon Client ID 不正确。请到“店铺连接”重新保存 Seller API 页面里的纯数字 Client ID。",
        status: 400,
        meta: { path: error.path, status: error.status, ozonCode: error.code },
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        code: "ozon_auth_failed",
        message: "Ozon 授权失败。请检查 Client ID、API Key，以及这个 API Key 是否有读取商品、库存和订单的权限。",
        status: 400,
        meta: { path: error.path, status: error.status, ozonCode: error.code },
      };
    }
    if (error.status === 429) {
      return {
        code: "ozon_rate_limited",
        message: "Ozon 接口限流了，请稍后再刷新数据。",
        status: 429,
        meta: { path: error.path, status: error.status, ozonCode: error.code },
      };
    }
    return {
      code: "ozon_api_failed",
      message: `Ozon 接口返回异常：${error.path} / HTTP ${error.status}`,
      status: 502,
      meta: { path: error.path, status: error.status, ozonCode: error.code },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message === "invalid_ozon_client_id") {
    return {
      code: "invalid_ozon_client_id",
      message: "Ozon Client ID 必须是纯数字正整数。请到“店铺连接”里重新保存正确的 Client ID。",
      status: 400,
      meta: {},
    };
  }
  if (message === "no_ozon_store") {
    return {
      code: "no_ozon_store",
      message: "还没有配置 Ozon 店铺",
      status: 400,
      meta: {},
    };
  }
  return {
    code: "ozon_sync_failed",
    message,
    status: 502,
    meta: {},
  };
}

function serializeDailyOrders(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const data = item as Record<string, Prisma.JsonValue>;
      return {
        date: typeof data.date === "string" ? data.date : "",
        fbs: typeof data.fbs === "number" ? data.fbs : 0,
        fbo: typeof data.fbo === "number" ? data.fbo : 0,
      };
    })
    .filter((item): item is { date: string; fbs: number; fbo: number } => Boolean(item?.date));
}

function serializeTopProducts(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const topProducts = (value as Record<string, Prisma.JsonValue>).topProducts;
  if (!Array.isArray(topProducts)) return [];
  return topProducts
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const data = item as Record<string, Prisma.JsonValue>;
      return {
        offerId: typeof data.offerId === "string" ? data.offerId : "",
        name: typeof data.name === "string" ? data.name : null,
        quantity: typeof data.quantity === "number" ? data.quantity : 0,
        revenueRub: typeof data.revenueRub === "number" ? data.revenueRub : 0,
      };
    })
    .filter((item): item is { offerId: string; name: string | null; quantity: number; revenueRub: number } =>
      Boolean(item?.offerId),
    );
}

export async function getOzonAnalyticsView(params: {
  tenantId: string;
  storeId?: string | null;
}): Promise<OzonAnalyticsView> {
  const requestedStoreId = optionalStoreId(params.storeId);
  const stores = await prisma.store.findMany({
    where: { tenantId: params.tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, isDefault: true },
  });
  const store = requestedStoreId
    ? stores.find((item) => item.id === requestedStoreId) ?? null
    : stores[0] ?? null;

  const [snapshot, products, collected, productPool, drafts, compiledDrafts, submittedRuns] = await Promise.all([
    store
      ? prisma.ozonAnalyticsSnapshot.findFirst({
          where: { tenantId: params.tenantId, storeId: store.id },
          orderBy: { syncedAt: "desc" },
        })
      : Promise.resolve(null),
    store
      ? prisma.ozonProductSnapshot.findMany({
          where: { tenantId: params.tenantId, storeId: store.id },
          orderBy: [{ stock: "asc" }, { updatedAt: "desc" }],
          take: 50,
        })
      : Promise.resolve([]),
    prisma.shopProductSnapshot.count({ where: { tenantId: params.tenantId } }),
    prisma.sourceProduct.count({ where: { tenantId: params.tenantId } }),
    prisma.ozonDraft.count({ where: { tenantId: params.tenantId } }),
    prisma.ozonDraft.count({ where: { tenantId: params.tenantId, status: "COMPILED" } }),
    prisma.publishRun.count({ where: { tenantId: params.tenantId, status: "submitted" } }),
  ]);
  const rawSnapshot = asRecord(snapshot?.rawJson);
  const orders = orderDataStatus(rawSnapshot.orderDataStatus);
  const knownOrders = orders.state !== "unknown";
  const latestSnapshot = snapshot ? {
    id: snapshot.id,
    syncedAt: snapshot.syncedAt.toISOString(),
    periodFrom: snapshot.periodFrom.toISOString(),
    periodTo: snapshot.periodTo.toISOString(),
    productCount: snapshot.productCount,
    visibleProductCount: nullableNumber(rawSnapshot.visibleProductCount, snapshot.visibleProductCount),
    archivedProductCount: snapshot.archivedProductCount,
    totalStock: nullableNumber(rawSnapshot.totalStock, snapshot.totalStock),
    lowStockCount: nullableNumber(rawSnapshot.lowStockCount, snapshot.lowStockCount),
    fbsOrderCount: knownOrders ? nullableNumber(rawSnapshot.fbsOrderCount, snapshot.fbsOrderCount) : null,
    fboOrderCount: knownOrders ? nullableNumber(rawSnapshot.fboOrderCount, snapshot.fboOrderCount) : null,
    pendingShipmentCount: knownOrders
      ? nullableNumber(rawSnapshot.pendingShipmentCount, snapshot.pendingShipmentCount)
      : null,
    cancelledOrderCount: knownOrders
      ? nullableNumber(rawSnapshot.cancelledOrderCount, snapshot.cancelledOrderCount)
      : null,
    grossRevenueRub: knownOrders && rawSnapshot.grossRevenueRub !== null
      ? snapshot.grossRevenueRub.toString()
      : null,
    orderDataStatus: orders,
    orderAmountBasis: rawSnapshot.orderAmountBasis === "payout_with_sale_price_fallback"
      ? "payout_with_sale_price_fallback" as const
      : null,
    dailyOrders: serializeDailyOrders(snapshot.dailyOrdersJson),
    topProducts: serializeTopProducts(snapshot.rawJson),
    error: snapshot.error,
  } : null;

  return {
    store,
    stores,
    latestSnapshot,
    products: products.map((product) => ({
      id: product.id,
      productId: product.productId,
      offerId: product.offerId,
      name: product.name,
      status: product.status,
      visible: asRecord(product.rawJson).visible === null ? null : product.visible,
      archived: product.archived,
      stock: asRecord(product.rawJson).stock === null ? null : product.stock,
      reservedStock: asRecord(product.rawJson).reservedStock === null ? null : product.reservedStock,
      priceRub: product.priceRub?.toString() ?? null,
      imageUrl: product.imageUrl,
      syncedAt: product.syncedAt.toISOString(),
    })),
    localFunnel: {
      collected,
      productPool,
      drafts,
      compiledDrafts,
      submittedRuns,
    },
  };
}

export async function syncOzonAnalytics(params: {
  tenantId: string;
  userId?: string;
  storeId?: string | null;
}) {
  const requestedStoreId = optionalStoreId(params.storeId);
  const store = await prisma.store.findFirst({
    where: {
      tenantId: params.tenantId,
      ...(requestedStoreId ? { id: requestedStoreId } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (!store) {
    throw new Error("no_ozon_store");
  }

  const periodTo = new Date();
  const periodFrom = daysAgo(6);
  assertOzonClientId(store.ozonClientId);
  const client = new OzonClient({
    clientId: store.ozonClientId,
    apiKey: decryptSecret(store.ozonApiKey),
    baseUrl: env.ozonApiBase,
    enableRealSubmit: env.enableRealOzonSubmit,
  });

  const summary = await getOzonAnalyticsSummary({
    client,
    since: periodFrom,
    to: periodTo,
  });

  await saveOzonAnalyticsSnapshot({
    tenantId: params.tenantId,
    storeId: store.id,
    summary,
    periodFrom,
    periodTo,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: "ozon.analytics.sync",
      entityType: "store",
      entityId: store.id,
      metaJson: {
        warningCount: summary.warnings?.length ?? 0,
      } as never,
    },
  });

  return getOzonAnalyticsView({ tenantId: params.tenantId, storeId: store.id });
}

async function saveOzonAnalyticsSnapshot(params: {
  tenantId: string;
  storeId: string;
  summary: OzonAnalyticsSummary;
  periodFrom: Date;
  periodTo: Date;
}) {
  const syncedAt = new Date();
  const products = params.summary.products.slice(0, 1000);

  for (let index = 0; index < products.length; index += 100) {
    const chunk = products.slice(index, index + 100);
    await prisma.$transaction(
      chunk.map((product) =>
        prisma.ozonProductSnapshot.upsert({
          where: {
            storeId_offerId: {
              storeId: params.storeId,
              offerId: product.offerId,
            },
          },
          update: {
            productId: product.productId,
            name: product.name,
            status: product.status,
            ...(product.visible === null ? {} : { visible: product.visible }),
            archived: product.archived,
            ...(product.stock === null ? {} : { stock: product.stock }),
            ...(product.reservedStock === null ? {} : { reservedStock: product.reservedStock }),
            priceRub: product.priceRub == null ? null : new Prisma.Decimal(product.priceRub),
            imageUrl: product.imageUrl,
            rawJson: product as never,
            syncedAt,
          },
          create: {
            tenantId: params.tenantId,
            storeId: params.storeId,
            productId: product.productId,
            offerId: product.offerId,
            name: product.name,
            status: product.status,
            visible: product.visible ?? false,
            archived: product.archived,
            stock: product.stock ?? 0,
            reservedStock: product.reservedStock ?? 0,
            priceRub: product.priceRub == null ? null : new Prisma.Decimal(product.priceRub),
            imageUrl: product.imageUrl,
            rawJson: product as never,
            syncedAt,
          },
        }),
      ),
    );
  }

  await prisma.ozonProductSnapshot.deleteMany({
    where: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      offerId: { notIn: products.map((product) => product.offerId) },
    },
  });

  await prisma.ozonAnalyticsSnapshot.create({
    data: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      periodFrom: params.periodFrom,
      periodTo: params.periodTo,
      productCount: params.summary.productCount,
      visibleProductCount: params.summary.visibleProductCount ?? 0,
      archivedProductCount: params.summary.archivedProductCount,
      totalStock: params.summary.totalStock ?? 0,
      lowStockCount: params.summary.lowStockCount ?? 0,
      fbsOrderCount: params.summary.fbsOrderCount ?? 0,
      fboOrderCount: params.summary.fboOrderCount ?? 0,
      pendingShipmentCount: params.summary.pendingShipmentCount ?? 0,
      cancelledOrderCount: params.summary.cancelledOrderCount ?? 0,
      grossRevenueRub: new Prisma.Decimal(params.summary.grossRevenueRub ?? 0),
      dailyOrdersJson: params.summary.dailyOrders as never,
      rawJson: params.summary as never,
      error: params.summary.warnings?.length ? params.summary.warnings.join("\n") : null,
    },
  });
}
