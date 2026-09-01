import { Prisma, prisma } from "@saas/db";
import { getOzonAnalyticsView, syncOzonAnalytics } from "@/lib/ozon-analytics";
import { getProfitGuardrails } from "./policy";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function purchaseCostFromFact(value: Prisma.JsonValue | null | undefined) {
  const record = asRecord(value);
  const purchase = asRecord(record.purchaseCny);
  return numberFrom(purchase.value) ?? numberFrom(record.purchaseCny);
}

export async function getAgentStoreSnapshot(params: {
  tenantId: string;
  userId?: string;
  storeId?: string | null;
  refreshOzonData?: boolean;
}) {
  const refreshOzonData = params.refreshOzonData ?? true;
  if (refreshOzonData) {
    await syncOzonAnalytics({
      tenantId: params.tenantId,
      userId: params.userId,
      storeId: params.storeId,
    });
  }

  const view = await getOzonAnalyticsView({
    tenantId: params.tenantId,
    storeId: params.storeId,
  });

  const defaultRule = await prisma.pricingRule.findFirst({
    where: {
      tenantId: params.tenantId,
      OR: [
        { storeId: view.store?.id ?? undefined },
        { storeId: null, isDefault: true },
      ],
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  const sourceProducts = await prisma.sourceProduct.findMany({
    where: {
      tenantId: params.tenantId,
      offerId: { in: view.products.map((item) => item.offerId) },
    },
    include: {
      productFacts: {
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
    take: 80,
  });
  const sourceByOfferId = new Map(sourceProducts.map((item) => [item.offerId, item]));

  const compiledDrafts = await prisma.ozonDraft.findMany({
    where: {
      tenantId: params.tenantId,
      storeId: view.store?.id,
      status: "COMPILED",
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      titleRu: true,
      priceRub: true,
      ozonCategoryId: true,
      product: {
        select: {
          id: true,
          offerId: true,
          title: true,
        },
      },
    },
  });

  return {
    store: view.store,
    stores: view.stores,
    latestSnapshot: view.latestSnapshot,
    guardrails: getProfitGuardrails(),
    pricingRule: defaultRule
      ? {
          id: defaultRule.id,
          name: defaultRule.name,
          cnyToRub: Number(defaultRule.cnyToRub),
          commissionRate: Number(defaultRule.commissionRate),
          domesticShippingCny: Number(defaultRule.domesticShippingCny),
          packagingCny: Number(defaultRule.packagingCny),
          internationalShippingRub: Number(defaultRule.internationalShippingRub),
          targetMarginRate: Number(defaultRule.targetMarginRate),
        }
      : null,
    products: view.products.slice(0, 50).map((product) => {
      const source = sourceByOfferId.get(product.offerId);
      const latestFact = source?.productFacts[0]?.normalizedJson;
      return {
        productSnapshotId: product.id,
        productId: product.productId,
        offerId: product.offerId,
        name: product.name,
        status: product.status,
        visible: product.visible,
        archived: product.archived,
        stock: product.stock,
        reservedStock: product.reservedStock,
        priceRub: product.priceRub ? Number(product.priceRub) : null,
        imageUrl: product.imageUrl,
        syncedAt: product.syncedAt,
        sourceProductId: source?.id ?? null,
        sourceTitle: source?.title ?? null,
        purchaseCostCny: purchaseCostFromFact(latestFact),
      };
    }),
    compiledDrafts: compiledDrafts.map((draft) => ({
      id: draft.id,
      productId: draft.product.id,
      offerId: draft.product.offerId,
      sourceTitle: draft.product.title,
      titleRu: draft.titleRu,
      priceRub: draft.priceRub ? Number(draft.priceRub) : null,
      ozonCategoryId: draft.ozonCategoryId,
    })),
  };
}
