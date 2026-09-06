import {
  decryptSecret,
  AgentActionStatus,
  AgentRiskLevel,
  type AgentActionType,
  prisma,
} from "@saas/db";
import {
  checkSubmitGuards,
  computeRequestHash,
  OzonClient,
  type ImportProductsRequest,
  type OzonAttribute,
  type OzonProductPayload,
} from "@saas/ozon";
import { env } from "@/lib/env";
import {
  actionNeedsApproval,
  actionApprovalPolicy,
  evaluateProfitGuardrail,
  isRecommendationOnly,
  type ProfitGuardrailResult,
} from "./policy";
import { promotionPolicySchema } from "./promotion-policy";
import { activatePromotionEnrollment } from "./promotions";

export type ProposedAgentAction = {
  type: AgentActionType;
  title: string;
  rationale: string;
  riskLevel?: AgentRiskLevel;
  storeId?: string | null;
  offerId?: string | null;
  productId?: string | null;
  payload?: {
    currentPriceRub?: number | null;
    proposedPriceRub?: number | null;
    costRub?: number | null;
    purchaseCostCny?: number | null;
    cnyToRub?: number | null;
    commissionRate?: number | null;
    [key: string]: unknown;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function productIdFrom(action: { productId: string | null; payloadJson: unknown }) {
  const payload = asRecord(action.payloadJson);
  return numberField(action.productId) ?? numberField(payload.productId);
}

function offerIdFrom(action: { offerId: string | null; payloadJson: unknown }) {
  const payload = asRecord(action.payloadJson);
  return action.offerId ?? stringField(payload.offerId);
}

function attributesFromPayload(value: unknown): OzonAttribute[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const attributes: OzonAttribute[] = [];
  for (const rawAttribute of value) {
    const attribute = asRecord(rawAttribute);
    const id = numberField(attribute.id);
    const rawValues = Array.isArray(attribute.values) ? attribute.values : [];
    const values: OzonAttribute["values"] = [];
    for (const rawValue of rawValues) {
      const item = asRecord(rawValue);
      const itemValue = stringField(item.value);
      if (!itemValue) continue;
      const dictionaryValueId = numberField(item.dictionaryValueId ?? item.dictionary_value_id);
      values.push({
        value: itemValue,
        ...(dictionaryValueId == null ? {} : { dictionaryValueId }),
      });
    }
    if (id && values.length) {
      attributes.push({ id, values });
    }
  }
  return attributes.length ? attributes : null;
}

function importPayloadFrom(value: unknown): ImportProductsRequest | null {
  const payload = asRecord(value);
  return Array.isArray(payload.items) && payload.items.length > 0
    ? (payload as unknown as ImportProductsRequest)
    : null;
}

function purchaseCostCnyFromFact(value: unknown) {
  const fact = asRecord(value);
  const purchase = asRecord(fact.purchaseCny);
  return numberField(purchase.value) ?? numberField(fact.purchaseCny);
}

async function evaluateTrustedPriceChange(params: {
  tenantId: string;
  storeId: string;
  offerId: string;
  proposedPriceRub: number;
}) {
  const [sourceProduct, pricingRule] = await Promise.all([
    prisma.sourceProduct.findFirst({
      where: { tenantId: params.tenantId, offerId: params.offerId },
      include: {
        productFacts: { orderBy: { updatedAt: "desc" }, take: 1 },
      },
    }),
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
  ]);
  return evaluateProfitGuardrail({
    actionType: "UPDATE_PRICE",
    proposedPriceRub: params.proposedPriceRub,
    purchaseCostCny: purchaseCostCnyFromFact(
      sourceProduct?.productFacts[0]?.normalizedJson,
    ),
    cnyToRub: pricingRule ? Number(pricingRule.cnyToRub) : null,
    commissionRate: pricingRule ? Number(pricingRule.commissionRate) : null,
  });
}

function contentSuggestionValue(payload: Record<string, unknown>, field: string) {
  const suggestions = payload.suggestions;
  if (!Array.isArray(suggestions)) return null;
  for (const suggestion of suggestions) {
    const item = asRecord(suggestion);
    if (item.field === field) {
      return stringField(item.suggestedRu);
    }
  }
  return null;
}

function supportedContentDraftFields(payload: Record<string, unknown>) {
  return ["title", "description"].filter((field) => contentSuggestionValue(payload, field));
}

function contentDraftImportPayload(action: {
  offerId: string | null;
  payloadJson: unknown;
}): { request: ImportProductsRequest; changedFields: string[] } {
  const payload = asRecord(action.payloadJson);
  const changedFields = supportedContentDraftFields(payload);
  if (!changedFields.length) {
    throw new Error("content_draft_no_supported_write_fields");
  }
  const product = asRecord(payload.product);
  const rawInfo = asRecord(product.rawInfo);
  const name =
    contentSuggestionValue(payload, "title") ??
    stringField(product.name) ??
    stringField(rawInfo.name);
  const description =
    contentSuggestionValue(payload, "description") ??
    stringField(product.description) ??
    stringField(rawInfo.description);
  const offerId =
    stringField(product.offerId) ??
    stringField(rawInfo.offer_id) ??
    action.offerId;
  const descriptionCategoryId =
    numberField(rawInfo.description_category_id) ??
    numberField(rawInfo.category_id);
  const typeId = numberField(rawInfo.type_id);
  const price =
    stringField(rawInfo.price) ??
    stringField(product.priceRub);
  const oldPrice =
    stringField(rawInfo.old_price) ??
    stringField(product.oldPriceRub) ??
    price;
  const images = stringArray(product.images).length
    ? stringArray(product.images)
    : stringArray(rawInfo.images);
  const attributes = Array.isArray(rawInfo.attributes)
    ? rawInfo.attributes
    : Array.isArray(product.attributes)
      ? product.attributes
      : null;
  const weight = numberField(rawInfo.weight);
  const width = numberField(rawInfo.width);
  const height = numberField(rawInfo.height);
  const depth = numberField(rawInfo.depth);

  const missing = [
    !offerId ? "offer_id" : "",
    !name ? "name" : "",
    !description ? "description" : "",
    !descriptionCategoryId ? "description_category_id" : "",
    !typeId ? "type_id" : "",
    !price ? "price" : "",
    !images.length ? "images" : "",
    !attributes ? "attributes" : "",
    !weight ? "weight" : "",
    !width ? "width" : "",
    !height ? "height" : "",
    !depth ? "depth" : "",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`content_draft_missing_import_payload:${missing.join(",")}`);
  }

  return {
    changedFields,
    request: {
      items: [
        {
          offer_id: offerId!,
          name: name!,
          description: description!,
          description_category_id: descriptionCategoryId!,
          type_id: typeId!,
          price: price!,
          old_price: oldPrice!,
          vat: stringField(rawInfo.vat) ?? "0",
          currency_code: "RUB",
          images,
          attributes: attributes as OzonProductPayload["attributes"],
          weight: weight!,
          width: width!,
          height: height!,
          depth: depth!,
          dimension_unit: "mm",
          weight_unit: "g",
        },
      ],
    },
  };
}

function actionStatus(action: ProposedAgentAction, guardrail: ProfitGuardrailResult): AgentActionStatus {
  if (!guardrail.allowed) return AgentActionStatus.BLOCKED;
  if (isRecommendationOnly(action.type)) return AgentActionStatus.RECOMMENDED;
  if (actionNeedsApproval(action.type)) return AgentActionStatus.PENDING_APPROVAL;
  return AgentActionStatus.RECOMMENDED;
}

export async function createAgentActions(params: {
  tenantId: string;
  sessionId: string;
  runId?: string | null;
  requestedBy?: string | null;
  actions: ProposedAgentAction[];
}) {
  const created = [];
  for (const action of params.actions.slice(0, 20)) {
    const offerId = action.offerId ?? stringField(action.payload?.offerId);
    const proposedPriceRub = action.payload?.proposedPriceRub ?? null;
    const guardrail =
      action.type === "UPDATE_PRICE" && action.storeId && offerId && proposedPriceRub
        ? await evaluateTrustedPriceChange({
            tenantId: params.tenantId,
            storeId: action.storeId,
            offerId,
            proposedPriceRub,
          })
        : evaluateProfitGuardrail({
            actionType: action.type,
            proposedPriceRub,
          });
    const approvalPolicy = actionApprovalPolicy(action.type);
    const status = actionStatus(action, guardrail);
    const record = await prisma.agentAction.create({
      data: {
        tenantId: params.tenantId,
        sessionId: params.sessionId,
        runId: params.runId ?? undefined,
        type: action.type,
        status,
        riskLevel: action.riskLevel ?? AgentRiskLevel.MEDIUM,
        storeId: action.storeId ?? undefined,
        offerId: action.offerId ?? undefined,
        productId: action.productId ?? undefined,
        title: action.title.slice(0, 240),
        rationale: action.rationale.slice(0, 2000),
        payloadJson: (action.payload ?? {}) as never,
        guardrailJson: { ...guardrail, approvalPolicy } as never,
        requestedBy: params.requestedBy ?? undefined,
        error: guardrail.allowed ? undefined : guardrail.reason,
      },
    });
    created.push(record);
  }

  if (created.length) {
    await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.requestedBy ?? undefined,
        action: "agent.actions.proposed",
        entityType: "agent_session",
        entityId: params.sessionId,
        metaJson: {
          runId: params.runId,
          actionIds: created.map((item) => item.id),
          blockedCount: created.filter((item) => item.status === "BLOCKED").length,
        } as never,
      },
    });
  }

  return created;
}

export async function approveAgentAction(params: {
  tenantId: string;
  userId: string;
  actionId: string;
}) {
  const action = await prisma.agentAction.findFirst({
    where: { id: params.actionId, tenantId: params.tenantId },
  });
  if (!action) return null;
  if (action.status !== "PENDING_APPROVAL") return action;

  const updated = await prisma.agentAction.update({
    where: { id: action.id },
    data: {
      status: AgentActionStatus.APPROVED,
      approvedBy: params.userId,
      approvedAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: "agent.action.approved",
      entityType: "agent_action",
      entityId: action.id,
      metaJson: { type: action.type } as never,
    },
  });
  return updated;
}

export async function rejectAgentAction(params: {
  tenantId: string;
  userId: string;
  actionId: string;
  reason?: string | null;
}) {
  const action = await prisma.agentAction.findFirst({
    where: { id: params.actionId, tenantId: params.tenantId },
  });
  if (!action) return null;
  if (!["PENDING_APPROVAL", "RECOMMENDED", "BLOCKED"].includes(action.status)) {
    return action;
  }

  const updated = await prisma.agentAction.update({
    where: { id: action.id },
    data: {
      status: AgentActionStatus.REJECTED,
      rejectedBy: params.userId,
      rejectedAt: new Date(),
      error: params.reason ?? action.error,
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: "agent.action.rejected",
      entityType: "agent_action",
      entityId: action.id,
      metaJson: { type: action.type, reason: params.reason } as never,
    },
  });
  return updated;
}

async function resolveActionStore(action: { tenantId: string; storeId: string | null }) {
  if (!action.storeId) throw new Error("missing_store_id");
  const store = await prisma.store.findFirst({
    where: { id: action.storeId, tenantId: action.tenantId },
    select: { id: true, ozonClientId: true, ozonApiKey: true },
  });
  if (!store) throw new Error("ozon_store_not_found");
  if (!store.ozonClientId || !store.ozonApiKey) {
    throw new Error("ozon_store_not_configured");
  }
  return store;
}

function ozonClientForStore(store: { ozonClientId: string; ozonApiKey: string }) {
  return new OzonClient({
    clientId: store.ozonClientId,
    apiKey: decryptSecret(store.ozonApiKey),
    baseUrl: env.ozonApiBase,
  });
}

async function verifyCurrentProduct(params: {
  client: OzonClient;
  offerId?: string | null;
  productId?: number | null;
}) {
  const productIds = params.productId ? [String(params.productId)] : undefined;
  const offerIds = params.offerId ? [params.offerId] : undefined;
  if (!productIds?.length && !offerIds?.length) return null;
  const items = await params.client.getProductInfoList({ productIds, offerIds });
  const product = items[0] ?? null;
  if (!product) throw new Error("product_not_found_before_execution");
  return product;
}

async function markActionExecuted(params: {
  tenantId: string;
  userId: string;
  action: { id: string; type: AgentActionType; guardrailJson: unknown };
  execution: Record<string, unknown>;
}) {
  const updated = await prisma.agentAction.update({
    where: { id: params.action.id },
    data: {
      status: AgentActionStatus.EXECUTED,
      executedAt: new Date(),
      error: null,
      guardrailJson: {
        ...asRecord(params.action.guardrailJson),
        execution: params.execution,
      } as never,
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: "agent.action.executed",
      entityType: "agent_action",
      entityId: params.action.id,
      metaJson: { type: params.action.type, execution: params.execution } as never,
    },
  });
  return updated;
}

async function markActionFailed(params: {
  tenantId: string;
  userId: string;
  action: { id: string; type: AgentActionType };
  error: string;
}) {
  const updated = await prisma.agentAction.update({
    where: { id: params.action.id },
    data: {
      status: AgentActionStatus.FAILED,
      error: params.error,
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: "agent.action.failed",
      entityType: "agent_action",
      entityId: params.action.id,
      metaJson: { type: params.action.type, error: params.error.slice(0, 1500) } as never,
    },
  });
  return updated;
}

async function executePublishDraftAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  const draftId = stringField(payload.draftId);
  if (!draftId) throw new Error("missing_draft_id");

  const draft = await prisma.ozonDraft.findFirst({
    where: { id: draftId, tenantId: params.tenantId },
    include: { product: { include: { productAssets: true } }, store: true },
  });
  if (!draft) throw new Error("ozon_draft_not_found");
  if (draft.status !== "COMPILED") throw new Error("ozon_draft_not_compiled");
  if (!draft.store.ozonClientId || !draft.store.ozonApiKey) {
    throw new Error("ozon_store_not_configured");
  }
  const request = asRecord(draft.payloadJson);
  if (!Array.isArray(request.items) || request.items.length === 0) {
    throw new Error("invalid_draft_payload");
  }

  const requestHash = computeRequestHash(draft.storeId, request);
  const duplicate = await prisma.publishRun.findUnique({
    where: { storeId_requestHash: { storeId: draft.storeId, requestHash } },
  });
  if (duplicate) throw new Error("duplicate_submission");

  const xiangjiCredentialCount = await prisma.xiangjiCredential.count({ where: { tenantId: params.tenantId } });
  const hasPrice = request.items.every((item) => Number(asRecord(item).price) > 0);
  const guard = checkSubmitGuards({
    hasOzonCredentials: Boolean(draft.store.ozonClientId && draft.store.ozonApiKey),
    hasXiangjiKey: xiangjiCredentialCount > 0,
    hasMainImage: draft.product.productAssets.some((asset) => asset.kind === "main_image" || asset.kind === "sku_image"),
    hasDetailImage: draft.product.productAssets.some((asset) => asset.kind === "detail_image"),
    hasPrice,
    payload: request,
    duplicateSubmission: false,
  });
  if (!guard.ok) throw new Error(`submit_guard_failed: ${guard.failures.join("; ")}`);

  const client = ozonClientForStore(draft.store);
  const response = await client.importProducts(request as never);
  const run = await prisma.publishRun.create({
    data: {
      tenantId: params.tenantId,
      draftId: draft.id,
      storeId: draft.storeId,
      requestHash,
      ozonTaskId: String(response.task_id),
      status: "submitted",
      requestJson: request as never,
      responseJson: response as never,
    },
  });
  await prisma.ozonDraft.update({
    where: { id: draft.id },
    data: { status: "SUBMITTED" },
  });
  await prisma.sourceProduct.update({
    where: { id: draft.productId },
    data: { status: "submitted" },
  });
  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "PUBLISH_DRAFT",
      publishRunId: run.id,
      ozonTaskId: String(response.task_id),
      requestHash,
    },
  });
}

async function executeContentDraftAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const store = await resolveActionStore(action);
  const { request, changedFields } = contentDraftImportPayload(action);
  const requestHash = computeRequestHash(store.id, request);
  const client = ozonClientForStore(store);
  await verifyCurrentProduct({
    client,
    offerId: offerIdFrom(action) ?? request.items[0]?.offer_id,
    productId: productIdFrom(action),
  });
  const response = await client.importProducts(request);
  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "CONTENT_DRAFT",
      ozonTaskId: String(response.task_id),
      requestHash,
      changedFields,
    },
  });
}

async function executePriceAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  const store = await resolveActionStore(action);
  const offerId = action.offerId ?? stringField(payload.offerId);
  const proposedPriceRub = numberField(payload.proposedPriceRub);
  if (!offerId) throw new Error("missing_offer_id");
  if (!proposedPriceRub || proposedPriceRub <= 0) throw new Error("missing_or_invalid_price");
  const client = ozonClientForStore(store);
  await verifyCurrentProduct({ client, offerId });
  const trustedGuardrail = await evaluateTrustedPriceChange({
    tenantId: params.tenantId,
    storeId: store.id,
    offerId,
    proposedPriceRub,
  });
  if (!trustedGuardrail.allowed) {
    throw new Error(`trusted_price_guardrail_failed:${trustedGuardrail.reason}`);
  }

  const response = await client.importPrices({
    prices: [
      {
        offer_id: offerId,
        price: String(proposedPriceRub),
        old_price: stringField(payload.oldPriceRub) ?? "0",
        currency_code: "RUB",
        vat: stringField(payload.vat) ?? "0",
      },
    ],
  });

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "UPDATE_PRICE",
      offerId,
      price: proposedPriceRub,
      ozonTaskId: response.task_id == null ? null : String(response.task_id),
      response: response.raw,
    },
  });
}

async function executeStockAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const offerId = offerIdFrom(action);
  const productId = productIdFrom(action);
  const stock = numberField(payload.stock);
  const warehouseId = numberField(payload.warehouseId ?? payload.warehouse_id);
  if (!offerId && !productId) throw new Error("missing_offer_id_or_product_id");
  if (stock == null || stock < 0) throw new Error("missing_or_invalid_stock");
  if (!warehouseId) throw new Error("missing_warehouse_id");
  await verifyCurrentProduct({ client, offerId, productId });

  const response = await client.updateStocks({
    stocks: [
      {
        ...(offerId ? { offer_id: offerId } : {}),
        ...(productId ? { product_id: productId } : {}),
        stock,
        warehouse_id: warehouseId,
        ...(numberField(payload.quantSize ?? payload.quant_size) ? { quant_size: numberField(payload.quantSize ?? payload.quant_size)! } : {}),
      },
    ],
  });

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "UPDATE_STOCK",
      offerId,
      productId,
      warehouseId,
      stock,
      response: response.raw,
    },
  });
}

async function executeImagesAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const productId = productIdFrom(action);
  const images = stringArray(payload.images);
  const images360 = stringArray(payload.images360);
  const colorImage = stringField(payload.colorImage ?? payload.color_image);
  if (!productId) throw new Error("missing_product_id");
  if (!images.length) throw new Error("missing_images");
  await verifyCurrentProduct({ client, productId });

  const response = await client.importPictures({
    product_id: productId,
    images,
    ...(images360.length ? { images360 } : {}),
    ...(colorImage ? { color_image: colorImage } : {}),
  });

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "UPDATE_IMAGES",
      productId,
      imageCount: images.length,
      response: response.raw,
    },
  });
}

async function executeAttributesAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const offerId = offerIdFrom(action);
  const productId = productIdFrom(action);
  const attributes = attributesFromPayload(payload.attributes);
  if (!offerId && !productId) throw new Error("missing_offer_id_or_product_id");
  if (!attributes) throw new Error("missing_attributes");
  await verifyCurrentProduct({ client, offerId, productId });

  const response = await client.updateAttributes({
    items: [
      {
        ...(offerId ? { offer_id: offerId } : {}),
        ...(productId ? { product_id: productId } : {}),
        attributes,
      },
    ],
  });

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "UPDATE_ATTRIBUTES",
      offerId,
      productId,
      attributeCount: attributes.length,
      response: response.raw,
    },
  });
}

async function executeCategoryAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const request = importPayloadFrom(payload.importPayload);
  if (!request) throw new Error("missing_import_payload");
  await verifyCurrentProduct({
    client,
    offerId: offerIdFrom(action) ?? stringField(request.items[0]?.offer_id),
    productId: productIdFrom(action),
  });
  const response = await client.importProducts(request);

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "UPDATE_CATEGORY",
      requestHash: computeRequestHash(store.id, request),
      ozonTaskId: String(response.task_id),
    },
  });
}

async function executeDeleteAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const offerId = offerIdFrom(action);
  const productId = productIdFrom(action);
  if (!offerId && !productId) throw new Error("missing_offer_id_or_product_id");
  await verifyCurrentProduct({ client, offerId, productId });

  const response = await client.deleteProducts({
    products: [
      {
        ...(productId ? { product_id: productId } : {}),
        ...(offerId ? { offer_id: offerId } : {}),
      },
    ],
  });

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "DELETE_PRODUCT",
      offerId,
      productId,
      response: response.raw,
    },
  });
}

async function executeBulkProductUpdateAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  const items = recordArray(payload.items);
  if (!items.length) throw new Error("missing_bulk_items");
  if (items.length > 50) throw new Error("bulk_item_limit_exceeded");

  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const results: Array<{ index: number; type: string | null; status: "executed" | "failed"; error?: string }> = [];

  for (const [index, item] of items.entries()) {
    const type = stringField(item.type ?? item.actionType);
    try {
      const offerId = stringField(item.offerId ?? item.offer_id);
      const productId = numberField(item.productId ?? item.product_id);
      await verifyCurrentProduct({ client, offerId, productId });

      if (type === "UPDATE_STOCK") {
        const stock = numberField(item.stock);
        const warehouseId = numberField(item.warehouseId ?? item.warehouse_id);
        if (stock == null || stock < 0) throw new Error("missing_or_invalid_stock");
        if (!warehouseId) throw new Error("missing_warehouse_id");
        await client.updateStocks({
          stocks: [{ ...(offerId ? { offer_id: offerId } : {}), ...(productId ? { product_id: productId } : {}), stock, warehouse_id: warehouseId }],
        });
      } else if (type === "UPDATE_IMAGES") {
        if (!productId) throw new Error("missing_product_id");
        const images = stringArray(item.images);
        if (!images.length) throw new Error("missing_images");
        await client.importPictures({ product_id: productId, images });
      } else if (type === "UPDATE_ATTRIBUTES") {
        const attributes = attributesFromPayload(item.attributes);
        if (!attributes) throw new Error("missing_attributes");
        await client.updateAttributes({
          items: [{ ...(offerId ? { offer_id: offerId } : {}), ...(productId ? { product_id: productId } : {}), attributes }],
        });
      } else if (type === "DELETE_PRODUCT") {
        if (!offerId && !productId) throw new Error("missing_offer_id_or_product_id");
        await client.deleteProducts({
          products: [{ ...(offerId ? { offer_id: offerId } : {}), ...(productId ? { product_id: productId } : {}) }],
        });
      } else if (type === "UPDATE_PRICE") {
        const price = numberField(item.proposedPriceRub ?? item.price);
        if (!offerId) throw new Error("missing_offer_id");
        if (!price || price <= 0) throw new Error("missing_or_invalid_price");
        const trustedGuardrail = await evaluateTrustedPriceChange({
          tenantId: params.tenantId,
          storeId: store.id,
          offerId,
          proposedPriceRub: price,
        });
        if (!trustedGuardrail.allowed) {
          throw new Error(`trusted_price_guardrail_failed:${trustedGuardrail.reason}`);
        }
        await client.importPrices({
          prices: [{ offer_id: offerId, price: String(price), old_price: stringField(item.oldPriceRub) ?? "0", currency_code: "RUB" }],
        });
      } else {
        throw new Error("unsupported_bulk_item_type");
      }
      results.push({ index, type, status: "executed" });
    } catch (error) {
      results.push({
        index,
        type,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = results.filter((item) => item.status === "failed");
  if (failed.length === results.length) {
    throw new Error("bulk_all_items_failed");
  }

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "BULK_PRODUCT_UPDATE",
      total: results.length,
      executed: results.length - failed.length,
      failed: failed.length,
      results,
    },
  });
}

async function executeArchiveAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const store = await resolveActionStore(action);
  const productId = numberField(action.productId);
  if (!productId) throw new Error("missing_product_id");
  const client = ozonClientForStore(store);
  await verifyCurrentProduct({ client, productId });
  const response =
    action.type === "ARCHIVE_PRODUCT"
      ? await client.archiveProducts({ product_id: [productId] })
      : await client.unarchiveProducts({ product_id: [productId] });

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: action.type,
      productId,
      response: response.raw,
    },
  });
}

async function executePromotionPolicyAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  if (!action.storeId) throw new Error("missing_store_id");
  if (!stringField(payload.sop)) throw new Error("missing_promotion_sop");
  if (!promotionPolicySchema.safeParse(payload.rule).success) {
    throw new Error("invalid_promotion_policy");
  }
  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: { kind: "PROMOTION_POLICY", storeId: action.storeId },
  });
}

async function executePromotionEnrollmentAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  const actionId = numberField(payload.actionId);
  const policyActionId = stringField(payload.policyActionId);
  const productIds = Array.isArray(payload.productIds)
    ? [...new Set(payload.productIds.map(numberField).filter((id): id is number => Boolean(id)))]
    : [];
  if (!action.storeId) throw new Error("missing_store_id");
  if (!actionId) throw new Error("missing_promotion_action_id");
  if (!policyActionId) throw new Error("missing_promotion_policy_action_id");
  if (!productIds.length || productIds.length > 20) {
    throw new Error("invalid_promotion_product_ids");
  }
  const result = await activatePromotionEnrollment({
    tenantId: params.tenantId,
    storeId: action.storeId,
    actionId,
    policyActionId,
    productIds,
  });
  if (!result.product_ids.length) {
    throw new Error(
      `promotion_all_products_rejected:${JSON.stringify(result.rejected).slice(0, 1500)}`,
    );
  }
  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "PROMOTION_ENROLLMENT",
      result: result.rejected.length ? "partial" : "complete",
      actionId,
      requestedProductCount: productIds.length,
      activatedProductIds: result.product_ids,
      rejected: result.rejected,
    },
  });
}

export async function executeApprovedAgentAction(params: {
  tenantId: string;
  userId: string;
  actionId: string;
}) {
  const action = await prisma.agentAction.findFirst({
    where: { id: params.actionId, tenantId: params.tenantId },
  });
  if (!action) return null;
  if (action.status !== "APPROVED") return action;

  const claim = await prisma.agentAction.updateMany({
    where: {
      id: action.id,
      tenantId: params.tenantId,
      status: AgentActionStatus.APPROVED,
    },
    data: {
      status: AgentActionStatus.BLOCKED,
      error: "execution_in_progress",
    },
  });
  if (claim.count !== 1) {
    return prisma.agentAction.findFirst({
      where: { id: action.id, tenantId: params.tenantId },
    });
  }
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        action: "agent.action.execution_started",
        entityType: "agent_action",
        entityId: action.id,
        metaJson: { type: action.type } as never,
      },
    });
    if (action.type === "PROMOTION_POLICY") {
      return await executePromotionPolicyAction({ ...params, action });
    }
    if (action.type === "PROMOTION_ENROLLMENT") {
      return await executePromotionEnrollmentAction({ ...params, action });
    }
    if (action.type === "PUBLISH_DRAFT") {
      return await executePublishDraftAction({ ...params, action });
    }
    if (action.type === "CONTENT_DRAFT") {
      return await executeContentDraftAction({ ...params, action });
    }
    if (action.type === "UPDATE_PRICE") {
      return await executePriceAction({ ...params, action });
    }
    if (action.type === "UPDATE_STOCK") {
      return await executeStockAction({ ...params, action });
    }
    if (action.type === "UPDATE_IMAGES") {
      return await executeImagesAction({ ...params, action });
    }
    if (action.type === "UPDATE_ATTRIBUTES") {
      return await executeAttributesAction({ ...params, action });
    }
    if (action.type === "UPDATE_CATEGORY") {
      return await executeCategoryAction({ ...params, action });
    }
    if (action.type === "DELETE_PRODUCT") {
      return await executeDeleteAction({ ...params, action });
    }
    if (action.type === "BULK_PRODUCT_UPDATE") {
      return await executeBulkProductUpdateAction({ ...params, action });
    }
    if (action.type === "ARCHIVE_PRODUCT" || action.type === "UNARCHIVE_PRODUCT") {
      return await executeArchiveAction({ ...params, action });
    }
    return await markActionFailed({
      tenantId: params.tenantId,
      userId: params.userId,
      action,
      error: "unsupported_action_execution",
    });
  } catch (error) {
    return markActionFailed({
      tenantId: params.tenantId,
      userId: params.userId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
