import { decryptSecret, prisma } from "@saas/db";
import {
  getOzonAnalyticsSummary,
  OzonClient,
  type OzonActionProduct,
} from "@saas/ozon";
import { env } from "@/lib/env";
import {
  evaluate,
  promotionPolicySchema,
  type PromotionPolicy,
} from "./promotion-policy";

type PromotionCandidateLike = Pick<
  OzonActionProduct,
  "id" | "price" | "action_price" | "max_action_price" | "stock"
>;

type SalesMetric = { orders30d: number; revenue30d: number };

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectPromotionCandidates(params: {
  candidates: PromotionCandidateLike[];
  policy: PromotionPolicy;
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
    const currentPrice = number(candidate.price);
    const actionPrice = number(candidate.action_price) || number(candidate.max_action_price);
    const sales = params.salesByProductId.get(String(candidate.id));
    const metrics = {
      stock: number(candidate.stock),
      currentPrice,
      actionPrice,
      maxActionPrice: number(candidate.max_action_price),
      discountRate: currentPrice > 0 ? (currentPrice - actionPrice) / currentPrice : 0,
      ...(sales ?? {}),
    };
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
  const store = await prisma.store.findFirst({
    where: { tenantId, ...(storeId ? { id: storeId } : {}) },
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
  if (!rule.success) return null;
  return { actionId: action.id, sop: String(payload?.sop ?? ""), rule: rule.data };
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
  const selected = selectPromotionCandidates({
    candidates,
    policy: policy.rule,
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
