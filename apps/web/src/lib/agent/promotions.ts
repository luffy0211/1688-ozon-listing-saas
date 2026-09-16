import { decryptSecret, prisma } from "@saas/db";
import {
  getOzonAnalyticsSummary,
  OzonClient,
  type OzonActionProduct,
} from "@saas/ozon";
import { env } from "@/lib/env";
import {
  calculatePromotionActionPrice,
  evaluate,
  promotionPriceRuleSchema,
  promotionPolicySchema,
  type PromotionPriceValues,
  type PromotionPriceRule,
  type PromotionPolicy,
} from "./promotion-policy";

type PromotionBusinessField =
  | "cost"
  | "costRub"
  | "cost_rub"
  | "logisticsFee"
  | "logistics_fee"
  | "logisticsFeeRub"
  | "commissionFee"
  | "commission_fee"
  | "commissionFeeRub"
  | "commissionRate"
  | "commission_rate"
  | "ozonNetPayout"
  | "ozon_net_payout"
  | "contentRating"
  | "content_rating"
  | "minProfit"
  | "min_profit";

type PromotionCandidateLike = Pick<
  OzonActionProduct,
  "id" | "price" | "action_price" | "max_action_price" | "stock"
> & Partial<Record<PromotionBusinessField, unknown>>;

type SalesMetric = { orders30d: number; revenue30d: number };

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalStoreId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && !["null", "undefined"].includes(trimmed.toLowerCase()) ? trimmed : null;
}

function optionalNumberField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function purchaseCostCnyFromFact(value: unknown) {
  const fact = record(value);
  const purchase = record(fact.purchaseCny);
  return optionalNumberField({ value: purchase.value, purchaseCny: fact.purchaseCny }, ["value", "purchaseCny"]);
}

type PromotionBusinessDefaults = {
  cost?: number;
  logisticsFee?: number;
  commissionRate?: number;
};

async function promotionBusinessDefaults(params: {
  tenantId: string;
  storeId: string;
  productIdToOfferId: Map<string, string>;
}) {
  const offerIds = [...new Set([...params.productIdToOfferId.values()].filter(Boolean))];
  const [pricingRule, sourceProducts] = await Promise.all([
    prisma.pricingRule.findFirst({
      where: {
        tenantId: params.tenantId,
        OR: [
          { storeId: params.storeId },
          { storeId: null, isDefault: true },
        ],
      },
      orderBy: [{ storeId: "desc" }, { isDefault: "desc" }, { updatedAt: "desc" }],
    }),
    offerIds.length
      ? prisma.sourceProduct.findMany({
          where: { tenantId: params.tenantId, offerId: { in: offerIds } },
          include: { productFacts: { orderBy: { updatedAt: "desc" }, take: 1 } },
        })
      : Promise.resolve([]),
  ]);
  const sourceByOfferId = new Map(sourceProducts.map((item) => [item.offerId, item]));
  const cnyToRub = pricingRule ? Number(pricingRule.cnyToRub) : 12;
  const domesticShippingRub = pricingRule ? Number(pricingRule.domesticShippingCny) * cnyToRub : 0;
  const packagingRub = pricingRule ? Number(pricingRule.packagingCny) * cnyToRub : 0;
  const internationalShippingRub = pricingRule ? Number(pricingRule.internationalShippingRub) : 0;
  const logisticsFee = domesticShippingRub + packagingRub + internationalShippingRub;
  const commissionRate = pricingRule ? Number(pricingRule.commissionRate) : undefined;
  const result = new Map<string, PromotionBusinessDefaults>();

  for (const [productId, offerId] of params.productIdToOfferId) {
    const sourceProduct = sourceByOfferId.get(offerId);
    const purchaseCostCny = purchaseCostCnyFromFact(sourceProduct?.productFacts[0]?.normalizedJson);
    const defaults: PromotionBusinessDefaults = {
      logisticsFee,
      commissionRate,
    };
    if (purchaseCostCny !== undefined) {
      defaults.cost = purchaseCostCny * cnyToRub;
    }
    result.set(productId, defaults);
  }
  return result;
}

export function selectPromotionCandidates(params: {
  candidates: PromotionCandidateLike[];
  policy: PromotionPolicy;
  priceRule: PromotionPriceRule;
  salesByProductId: Map<string, SalesMetric>;
}) {
  const eligible: Array<{
    productId: number;
    currentPrice: number;
    actionPrice: number;
    maxActionPrice: number;
    stock: number;
    discountRate: number;
    orders30d: number;
    revenue30d: number;
  }> = [];
  const rejected: Array<{ productId: number; reason: string }> = [];

  for (const candidate of params.candidates) {
    const rawCandidate = candidate as unknown as Record<string, unknown>;
    const currentPrice = number(candidate.price);
    const maxActionPrice = number(candidate.max_action_price);
    const sales = params.salesByProductId.get(String(candidate.id));
    const priceValues: PromotionPriceValues = {
      currentPrice,
      maxActionPrice,
      stock: number(candidate.stock),
      orders30d: sales?.orders30d,
      revenue30d: sales?.revenue30d,
      cost: optionalNumberField(rawCandidate, ["cost", "costRub", "cost_rub"]),
      logisticsFee: optionalNumberField(rawCandidate, ["logisticsFee", "logistics_fee", "logisticsFeeRub"]),
      commissionFee: optionalNumberField(rawCandidate, ["commissionFee", "commission_fee", "commissionFeeRub"]),
      commissionRate: optionalNumberField(rawCandidate, ["commissionRate", "commission_rate"]),
      ozonNetPayout: optionalNumberField(rawCandidate, ["ozonNetPayout", "ozon_net_payout"]),
      contentRating: optionalNumberField(rawCandidate, ["contentRating", "content_rating"]),
      minProfit: optionalNumberField(rawCandidate, ["minProfit", "min_profit"]),
    };
    const calculatedPrice = calculatePromotionActionPrice(params.priceRule, priceValues);
    if (!calculatedPrice.passed) {
      rejected.push({ productId: candidate.id, reason: calculatedPrice.reason });
      continue;
    }
    const actionPrice = calculatedPrice.actionPrice;
    const metrics = {
      stock: number(candidate.stock),
      currentPrice,
      actionPrice,
      maxActionPrice,
      discountRate: currentPrice > 0 ? (currentPrice - actionPrice) / currentPrice : 0,
      ...(sales ?? {}),
    };
    if (metrics.stock <= 0) {
      rejected.push({ productId: candidate.id, reason: "stock_unavailable" });
      continue;
    }
    if (currentPrice <= 0) {
      rejected.push({ productId: candidate.id, reason: "missing_current_price" });
      continue;
    }
    if (actionPrice <= 0) {
      rejected.push({ productId: candidate.id, reason: "invalid_action_price" });
      continue;
    }
    if (maxActionPrice > 0 && actionPrice > maxActionPrice) {
      rejected.push({ productId: candidate.id, reason: "action_price_above_ozon_max" });
      continue;
    }
    const result = evaluate(params.policy, metrics);
    if (!result.passed) {
      rejected.push({ productId: candidate.id, reason: result.reason });
      continue;
    }
    if (eligible.length < 20) {
      eligible.push({ productId: candidate.id, ...metrics, orders30d: sales?.orders30d ?? 0, revenue30d: sales?.revenue30d ?? 0 });
    }
  }
  return { eligible, rejected };
}

async function resolveStore(tenantId: string, storeId?: string | null) {
  const requestedStoreId = optionalStoreId(storeId);
  const store = await prisma.store.findFirst({
    where: { tenantId, ...(requestedStoreId ? { id: requestedStoreId } : {}) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, ozonClientId: true, ozonApiKey: true },
  });
  if (!store) throw new Error("ozon_store_not_found");
  if (!store.ozonClientId || !store.ozonApiKey) throw new Error("ozon_store_not_configured");
  return store;
}

function clientFor(
  store: { ozonClientId: string; ozonApiKey: string },
  enableRealSubmit = false,
) {
  return new OzonClient({
    clientId: store.ozonClientId,
    apiKey: decryptSecret(store.ozonApiKey),
    baseUrl: env.ozonApiBase,
    enableRealSubmit,
  });
}

async function listAllCandidates(client: OzonClient, actionId: number) {
  const products: OzonActionProduct[] = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const result = await client.listActionCandidates({
      action_id: actionId,
      limit: 100,
      offset,
    });
    products.push(...(result.products ?? []));
    if (products.length >= result.total || !result.products?.length) break;
  }
  return products;
}

export async function listOzonPromotions(params: {
  tenantId: string;
  storeId?: string | null;
}) {
  const store = await resolveStore(params.tenantId, params.storeId);
  const actions = await clientFor(store).listActions();
  return {
    store: { id: store.id, name: store.name },
    capturedAt: new Date().toISOString(),
    actions: actions.map((action) => ({
      id: action.id,
      title: action.title,
      actionType: action.action_type,
      dateStart: action.date_start,
      dateEnd: action.date_end,
      potentialProductsCount: action.potential_products_count,
      participatingProductsCount: action.participating_products_count,
      isParticipating: action.is_participating,
    })),
  };
}

export async function getOzonPromotionCandidates(params: {
  tenantId: string;
  storeId?: string | null;
  actionId: number;
}) {
  const store = await resolveStore(params.tenantId, params.storeId);
  const client = clientFor(store);
  const actions = await client.listActions();
  const action = actions.find((item) => item.id === params.actionId);
  if (!action) throw new Error("ozon_promotion_not_found");
  const products = await listAllCandidates(client, params.actionId);
  return {
    store: { id: store.id, name: store.name },
    action,
    products: products.slice(0, 100),
    total: products.length,
    capturedAt: new Date().toISOString(),
  };
}

export async function activePromotionPolicy(tenantId: string, storeId: string) {
  const action = await prisma.agentAction.findFirst({
    where: {
      tenantId,
      storeId,
      type: "PROMOTION_POLICY",
      status: "EXECUTED",
    },
    orderBy: [{ executedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!action) return null;
  const payload = action.payloadJson as Record<string, unknown> | null;
  const rule = promotionPolicySchema.safeParse(payload?.rule);
  const priceRule = promotionPriceRuleSchema.safeParse(payload?.priceRule);
  if (!rule.success || !priceRule.success) return null;
  return {
    actionId: action.id,
    sop: String(payload?.sop ?? ""),
    rule: rule.data,
    priceRule: priceRule.data,
  };
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export async function preparePromotionEnrollment(params: {
  tenantId: string;
  storeId?: string | null;
  actionId: number;
}) {
  const store = await resolveStore(params.tenantId, params.storeId);
  const policy = await activePromotionPolicy(params.tenantId, store.id);
  if (!policy) throw new Error("active_promotion_policy_required");
  const client = clientFor(store);
  const actions = await client.listActions();
  const action = actions.find((item) => item.id === params.actionId);
  if (!action) throw new Error("ozon_promotion_not_found");
  if (action.date_end && new Date(action.date_end).getTime() < Date.now()) {
    throw new Error("ozon_promotion_ended");
  }
  const now = new Date();
  const [candidates, analytics] = await Promise.all([
    listAllCandidates(client, params.actionId),
    getOzonAnalyticsSummary({ client, since: addDays(now, -29), to: now }),
  ]);
  const topByOffer = new Map(
    analytics.topProducts.map((item) => [
      item.offerId,
      { orders30d: item.quantity, revenue30d: item.revenueRub },
    ]),
  );
  const salesByProductId = new Map<string, SalesMetric>();
  const productIdToOfferId = new Map<string, string>();
  for (const product of analytics.products) {
    productIdToOfferId.set(product.productId, product.offerId);
    const sales = topByOffer.get(product.offerId);
    if (sales) salesByProductId.set(product.productId, sales);
  }
  const businessDefaults = await promotionBusinessDefaults({
    tenantId: params.tenantId,
    storeId: store.id,
    productIdToOfferId,
  });
  const selected = selectPromotionCandidates({
    candidates: candidates.map((candidate) => ({
      ...candidate,
      ...businessDefaults.get(String(candidate.id)),
    })),
    policy: policy.rule,
    priceRule: policy.priceRule,
    salesByProductId,
  });
  return {
    store: { id: store.id, name: store.name },
    action,
    policy,
    ...selected,
    capturedAt: now.toISOString(),
  };
}

export async function activatePromotionEnrollment(params: {
  tenantId: string;
  storeId: string;
  actionId: number;
  policyActionId: string;
  productIds: number[];
}) {
  const prepared = await preparePromotionEnrollment(params);
  if (prepared.policy.actionId !== params.policyActionId) {
    throw new Error("promotion_policy_changed");
  }
  const eligible = new Map(prepared.eligible.map((item) => [item.productId, item]));
  const selected = [...new Set(params.productIds)].slice(0, 20).map((id) => eligible.get(id));
  if (selected.some((item) => !item)) throw new Error("promotion_candidates_changed");
  const products = selected.flatMap((item) =>
    item
      ? [{ product_id: item.productId, action_price: item.actionPrice }]
      : [],
  );
  if (!products.length) throw new Error("no_eligible_promotion_products");
  const store = await resolveStore(params.tenantId, params.storeId);
  return clientFor(store, env.enableRealOzonSubmit).activateActionProducts({
    action_id: params.actionId,
    products,
  });
}
