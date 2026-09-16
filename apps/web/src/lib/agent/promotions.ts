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
  promotionScopeSchema,
  type PromotionPriceValues,
  type PromotionPriceRule,
  type PromotionPolicy,
  type PromotionScope,
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
  | "min_profit"
  | "offerId"
  | "name"
  | "publicSku"
  | "descriptionCategoryId"
  | "typeId";

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

type PromotionProductContext = PromotionBusinessDefaults & {
  offerId?: string;
  name?: string | null;
  publicSku?: string | null;
  descriptionCategoryId?: number | null;
  typeId?: number | null;
};

async function promotionProductContexts(params: {
  tenantId: string;
  storeId: string;
  analyticsProducts: Array<{
    productId: string;
    offerId: string;
    name: string | null;
    publicSku: string | null;
    descriptionCategoryId: number | null;
    typeId: number | null;
  }>;
}) {
  const offerIds = [...new Set(params.analyticsProducts.map((item) => item.offerId).filter(Boolean))];
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
  const result = new Map<string, PromotionProductContext>();

  for (const product of params.analyticsProducts) {
    const sourceProduct = sourceByOfferId.get(product.offerId);
    const purchaseCostCny = purchaseCostCnyFromFact(sourceProduct?.productFacts[0]?.normalizedJson);
    const defaults: PromotionProductContext = {
      offerId: product.offerId,
      name: product.name,
      publicSku: product.publicSku,
      descriptionCategoryId: product.descriptionCategoryId,
      typeId: product.typeId,
      logisticsFee,
      commissionRate,
    };
    if (purchaseCostCny !== undefined) {
      defaults.cost = purchaseCostCny * cnyToRub;
    }
    result.set(product.productId, defaults);
  }
  return result;
}

function numberSetIncludes(values: number[] | undefined, value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && values?.includes(parsed);
}

function scopeMatches(scope: PromotionScope, candidate: PromotionCandidateLike, currentPrice: number) {
  if (!scope) return { passed: true as const, reason: null };
  const item = candidate as Record<string, unknown>;
  const offerId = typeof item.offerId === "string" ? item.offerId : "";
  const descriptionCategoryId = optionalNumberField(item, ["descriptionCategoryId"]);
  const typeId = optionalNumberField(item, ["typeId"]);
  const categoryKey = descriptionCategoryId && typeId ? `${descriptionCategoryId}:${typeId}` : null;

  if (scope.offerIds?.length && !scope.offerIds.includes(offerId)) {
    return { passed: false as const, reason: "scope_offer_id_mismatch" };
  }
  if (scope.offerIdPrefixes?.length && !scope.offerIdPrefixes.some((prefix) => offerId.startsWith(prefix))) {
    return { passed: false as const, reason: "scope_offer_prefix_mismatch" };
  }
  if (scope.descriptionCategoryIds?.length && !numberSetIncludes(scope.descriptionCategoryIds, descriptionCategoryId)) {
    return { passed: false as const, reason: "scope_category_mismatch" };
  }
  if (scope.typeIds?.length && !numberSetIncludes(scope.typeIds, typeId)) {
    return { passed: false as const, reason: "scope_type_mismatch" };
  }
  if (scope.categoryKeys?.length && (!categoryKey || !scope.categoryKeys.includes(categoryKey))) {
    return { passed: false as const, reason: "scope_category_key_mismatch" };
  }
  if (scope.priceRange?.min !== undefined && currentPrice < scope.priceRange.min) {
    return { passed: false as const, reason: "scope_price_below_min" };
  }
  if (scope.priceRange?.max !== undefined && currentPrice > scope.priceRange.max) {
    return { passed: false as const, reason: "scope_price_above_max" };
  }
  return { passed: true as const, reason: null };
}

export function selectPromotionCandidates(params: {
  candidates: PromotionCandidateLike[];
  policy: PromotionPolicy;
  scope?: PromotionScope;
  priceRule: PromotionPriceRule;
  policyActionId?: string;
  salesByProductId: Map<string, SalesMetric>;
}) {
  const eligible: Array<{
    productId: number;
    offerId?: string;
    name?: string | null;
    categoryKey?: string | null;
    policyActionId?: string;
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
    const scopeResult = scopeMatches(params.scope, candidate, currentPrice);
    if (!scopeResult.passed) {
      rejected.push({ productId: candidate.id, reason: scopeResult.reason });
      continue;
    }
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
      const descriptionCategoryId = optionalNumberField(rawCandidate, ["descriptionCategoryId"]);
      const typeId = optionalNumberField(rawCandidate, ["typeId"]);
      eligible.push({
        productId: candidate.id,
        offerId: typeof rawCandidate.offerId === "string" ? rawCandidate.offerId : undefined,
        name: typeof rawCandidate.name === "string" ? rawCandidate.name : null,
        categoryKey: descriptionCategoryId && typeId ? `${descriptionCategoryId}:${typeId}` : null,
        policyActionId: params.policyActionId,
        ...metrics,
        orders30d: sales?.orders30d ?? 0,
        revenue30d: sales?.revenue30d ?? 0,
      });
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
  const scope = promotionScopeSchema.safeParse(payload?.scope);
  if (!rule.success || !priceRule.success || !scope.success) return null;
  return {
    actionId: action.id,
    sop: String(payload?.sop ?? ""),
    rule: rule.data,
    scope: scope.data,
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
  for (const product of analytics.products) {
    const sales = topByOffer.get(product.offerId);
    if (sales) salesByProductId.set(product.productId, sales);
  }
  const productContexts = await promotionProductContexts({
    tenantId: params.tenantId,
    storeId: store.id,
    analyticsProducts: analytics.products,
  });
  const selected = selectPromotionCandidates({
    candidates: candidates.map((candidate) => ({
      ...candidate,
      ...productContexts.get(String(candidate.id)),
    })),
    policy: policy.rule,
    scope: policy.scope,
    priceRule: policy.priceRule,
    policyActionId: policy.actionId,
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
