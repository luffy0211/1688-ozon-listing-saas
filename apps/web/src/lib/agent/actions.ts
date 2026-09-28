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
  type OzonProductInfoItem,
  type OzonProductPayload,
} from "@saas/ozon";
import { randomUUID } from "node:crypto";
import { env } from "../env";
import { consumeTenantCredits, refundTenantCredits } from "../credits";
import {
  actionNeedsApproval,
  actionApprovalPolicy,
  evaluateProfitGuardrail,
  isRecommendationOnly,
  type ProfitGuardrailResult,
} from "./policy";
import { promotionPolicySchema, promotionPriceRuleSchema, promotionScopeSchema } from "./promotion-policy";
import { activatePromotionEnrollment } from "./promotions";
import { validateContentDraftEdits, type ContentDraftEdit } from "./content-draft-edits";
import { claimPublishRun } from "./publish-claim";

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

export class AgentActionRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown[] = [],
    readonly status = 409,
  ) {
    super(message);
  }
}

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

type OzonMutationIdentity = { offerId?: string | null; productId?: string | number | null };

export function assertOzonMutationSucceeded(
  value: unknown,
  expected: OzonMutationIdentity[] = [],
) {
  const root = asRecord(value);
  const result = asRecord(root.result);
  const rawItems = Array.isArray(root.result)
    ? root.result
    : Array.isArray(result.items)
      ? result.items
      : Array.isArray(root.items)
        ? root.items
        : [];
  const items = rawItems.map(asRecord);
  if (!items.length) {
    throw new Error(`ozon_mutation_unknown:${JSON.stringify(root).slice(0, 1500)}`);
  }
  const rejected = items.filter((item) => {
    const status = stringField(item.status)?.toLowerCase();
    const errors = Array.isArray(item.errors) ? item.errors.filter(Boolean) : [];
    return item.updated === false || errors.length > 0 || status === "failed" || status === "error";
  });
  const updatedCount = items.filter((item) => item.updated === true).length;
  if (rejected.length) {
    const kind = updatedCount > 0 ? "ozon_mutation_partial" : "ozon_mutation_rejected";
    throw new Error(`${kind}:${JSON.stringify(rejected).slice(0, 1500)}`);
  }
  const missing = expected.filter((identity) => !items.some((item) => {
    const offerId = stringField(item.offer_id ?? item.offerId);
    const productId = stringField(item.product_id ?? item.productId);
    return (
      (identity.offerId != null && offerId === String(identity.offerId)) ||
      (identity.productId != null && productId === String(identity.productId))
    );
  }));
  if (missing.length) {
    throw new Error(`ozon_mutation_incomplete:${JSON.stringify(missing).slice(0, 1500)}`);
  }
  return { updatedCount, rejectedCount: 0 };
}

function assertOzonMutationNotRejected(value: unknown, expected: OzonMutationIdentity[]) {
  try {
    return assertOzonMutationSucceeded(value, expected);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ozon_mutation_unknown:")) return null;
    throw error;
  }
}

export function isUncertainOzonWriteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ozon_mutation_(?:rejected|partial|incomplete)|ozon_import_task_failed|trusted_.*guardrail_failed/i.test(message)) {
    return false;
  }
  return /timeout|timed out|socket hang up|econnreset|econnaborted|network|fetch failed|aborted/i.test(message);
}

function consistentIdentity(field: string, values: unknown[], numeric = false) {
  const ids = values.filter((value) => value != null).map((value) => {
    const id = stringField(value);
    if (!id || (numeric && (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0))) {
      throw new Error(`invalid_${field}`);
    }
    return numeric ? String(Number(id)) : id;
  });
  if (new Set(ids).size > 1) throw new Error(`product_identity_mismatch:${field}`);
  return ids[0] ?? null;
}

function productIdFrom(action: { productId: string | null; payloadJson: unknown }) {
  const payload = asRecord(action.payloadJson);
  const product = asRecord(payload.product);
  const raw = asRecord(product.rawInfo);
  return numberField(consistentIdentity("product_id", [
    action.productId, payload.productId, payload.product_id, product.productId, raw.id, raw.product_id,
  ], true));
}

function offerIdFrom(action: { offerId: string | null; payloadJson: unknown }) {
  const payload = asRecord(action.payloadJson);
  const product = asRecord(payload.product);
  return consistentIdentity("offer_id", [
    action.offerId, payload.offerId, payload.offer_id, product.offerId, asRecord(product.rawInfo).offer_id,
  ]);
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

const OZON_WRITE_ACTION_TYPES = new Set<AgentActionType>([
  "UPDATE_PRICE",
  "UPDATE_STOCK",
  "UPDATE_IMAGES",
  "UPDATE_ATTRIBUTES",
  "UPDATE_CATEGORY",
  "PUBLISH_DRAFT",
  "CONTENT_DRAFT",
  "ARCHIVE_PRODUCT",
  "UNARCHIVE_PRODUCT",
  "DELETE_PRODUCT",
  "BULK_PRODUCT_UPDATE",
  "PROMOTION_ENROLLMENT",
]);

function requiresRealOzonSubmit(actionType: AgentActionType) {
  return OZON_WRITE_ACTION_TYPES.has(actionType);
}

function assertRealOzonSubmitEnabled(actionType: AgentActionType) {
  if (requiresRealOzonSubmit(actionType) && process.env.ENABLE_REAL_OZON_SUBMIT !== "true") {
    throw new Error("real_ozon_submit_disabled");
  }
}

export function validateCompetitorBatchPayload(value: unknown) {
  const payload = asRecord(value);
  if (payload.source !== "competitor_attribute_playbook") return;

  const recommendations = recordArray(payload.recommendations);
  const items = recordArray(payload.items);
  if (!recommendations.length || !items.length) {
    throw new Error("competitor_batch_preview_mismatch");
  }
  if (items.some((item) => stringField(item.type ?? item.actionType) !== "UPDATE_ATTRIBUTES")) {
    throw new Error("competitor_batch_attributes_only");
  }

  const expected = new Map<string, { value: string; dictionaryValueId: number | null }>();
  for (const recommendation of recommendations) {
    const offerId = stringField(recommendation.offerId);
    const attributeId = numberField(recommendation.ozonAttributeId);
    const suggestedValue = stringField(recommendation.suggestedValue);
    const key = offerId && attributeId ? `${offerId}:${attributeId}` : null;
    if (!key || !suggestedValue || expected.has(key)) {
      throw new Error("competitor_batch_preview_mismatch");
    }
    expected.set(key, {
      value: suggestedValue,
      dictionaryValueId: numberField(recommendation.dictionaryValueId),
    });
  }

  const matched = new Set<string>();
  for (const item of items) {
    const offerId = stringField(item.offerId ?? item.offer_id);
    const attributes = attributesFromPayload(item.attributes);
    if (!offerId || !attributes) throw new Error("competitor_batch_preview_mismatch");
    for (const attribute of attributes) {
      const key = `${offerId}:${attribute.id}`;
      const actual = attribute.values[0];
      const preview = expected.get(key);
      if (
        attribute.values.length !== 1 ||
        !actual ||
        !preview ||
        matched.has(key) ||
        actual.value !== preview.value ||
        (actual.dictionaryValueId ?? null) !== preview.dictionaryValueId
      ) {
        throw new Error("competitor_batch_preview_mismatch");
      }
      matched.add(key);
    }
  }
  if (matched.size !== expected.size) throw new Error("competitor_batch_preview_mismatch");
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

function attributeTextValue(attribute: unknown) {
  const values = asRecord(attribute).values;
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    const text = stringField(asRecord(value).value);
    if (text) return text;
  }
  return null;
}

function attributeValueById(attributes: unknown, id: number) {
  if (!Array.isArray(attributes)) return null;
  const attribute = attributes.find((item) => numberField(asRecord(item).id) === id);
  return attribute ? attributeTextValue(attribute) : null;
}

const OZON_DESCRIPTION_ATTRIBUTE_ID = 4191;

function withDescriptionAttribute(attributes: unknown[], description: string): OzonAttribute[] {
  let found = false;
  const next = attributes.map((attribute) => {
    const item = asRecord(attribute);
    if (numberField(item.id) !== OZON_DESCRIPTION_ATTRIBUTE_ID) {
      return attribute as OzonAttribute;
    }
    found = true;
    return {
      ...item,
      id: OZON_DESCRIPTION_ATTRIBUTE_ID,
      values: [{ value: description }],
    } as OzonAttribute;
  });
  return found
    ? next
    : [...next, { id: OZON_DESCRIPTION_ATTRIBUTE_ID, values: [{ value: description }] }];
}

function supportedContentDraftFields(payload: Record<string, unknown>) {
  return ["title", "description"].filter((field) => contentSuggestionValue(payload, field));
}

export function contentDraftFieldConflicts(
  action: { offerId: string | null; payloadJson: unknown },
  latestProduct: OzonProductInfoItem,
) {
  const payload = asRecord(action.payloadJson);
  const suggestions = recordArray(payload.suggestions);
  return suggestions.flatMap((suggestion) => {
    const field = stringField(suggestion.field);
    const previous = stringField(suggestion.current);
    if (!previous || !field) return [];
    const latest = field === "title"
      ? stringField(latestProduct.name)
      : field === "description"
        ? stringField(latestProduct.description) ??
          attributeValueById(latestProduct.attributes, OZON_DESCRIPTION_ATTRIBUTE_ID)
        : null;
    return latest !== null && latest !== previous ? [field] : [];
  });
}

export function contentDraftImportPayload(action: {
  offerId: string | null;
  payloadJson: unknown;
}, latestProduct?: OzonProductInfoItem | null): { request: ImportProductsRequest; changedFields: string[] } {
  const payload = asRecord(action.payloadJson);
  const changedFields = supportedContentDraftFields(payload);
  if (!changedFields.length) {
    throw new Error("content_draft_no_supported_write_fields");
  }
  const product = asRecord(payload.product);
  const storedRawInfo = asRecord(product.rawInfo);
  const latest = asRecord(latestProduct);
  const rawInfo = Object.keys(latest).length
    ? { ...storedRawInfo, ...latest }
    : storedRawInfo;
  const name =
    contentSuggestionValue(payload, "title") ??
    stringField(rawInfo.name) ??
    stringField(product.name);
  const baseAttributes = Array.isArray(rawInfo.attributes)
    ? rawInfo.attributes
    : Array.isArray(product.attributes)
      ? product.attributes
      : null;
  const description =
    contentSuggestionValue(payload, "description") ??
    stringField(rawInfo.description) ??
    stringField(product.description) ??
    attributeValueById(baseAttributes, OZON_DESCRIPTION_ATTRIBUTE_ID);
  const attributes = baseAttributes && description
    ? withDescriptionAttribute(baseAttributes, description)
    : baseAttributes;
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
  const currencyCode =
    stringField(rawInfo.currency_code) ??
    stringField(rawInfo.currencyCode) ??
    stringField(product.currency_code) ??
    stringField(product.currencyCode);
  const images = stringArray(rawInfo.images).length
    ? stringArray(rawInfo.images)
    : stringArray(product.images);
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
    !currencyCode ? "currency_code" : "",
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
          currency_code: currencyCode!,
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

function assertActionPreconditions(
  action: { updatedAt: Date; storeId?: string | null },
  expected: { expectedVersion: string; expectedStoreId: string | null },
) {
  if (action.updatedAt.toISOString() !== expected.expectedVersion) {
    throw new AgentActionRequestError("agent_action_stale", "草案已变化，请刷新后核对最新内容");
  }
  if (action.storeId !== expected.expectedStoreId) {
    throw new AgentActionRequestError("agent_action_store_mismatch", "草案所属店铺已变化，请刷新后重试");
  }
}

async function latestActionOrConflict(
  params: { tenantId: string; actionId: string },
  expectedStatus: string,
) {
  const latest = await prisma.agentAction.findFirst({
    where: { id: params.actionId, tenantId: params.tenantId },
  });
  if (!latest || latest.status !== expectedStatus) return latest;
  throw new AgentActionRequestError("agent_action_stale", "草案已变化，请刷新后核对最新内容");
}

export async function approveAgentAction(params: {
  tenantId: string;
  userId: string;
  actionId: string;
  expectedVersion: string;
  expectedStoreId: string | null;
}) {
  const action = await prisma.agentAction.findFirst({
    where: { id: params.actionId, tenantId: params.tenantId },
  });
  if (!action) return null;
  if (action.status !== AgentActionStatus.PENDING_APPROVAL) return action;
  assertActionPreconditions(action, params);

  const claimed = await prisma.agentAction.updateMany({
    where: {
      id: action.id,
      tenantId: params.tenantId,
      status: AgentActionStatus.PENDING_APPROVAL,
      updatedAt: action.updatedAt,
    },
    data: {
      status: AgentActionStatus.APPROVED,
      approvedBy: params.userId,
      approvedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    return latestActionOrConflict(params, AgentActionStatus.PENDING_APPROVAL);
  }
  const updated = await prisma.agentAction.findFirst({
    where: { id: action.id, tenantId: params.tenantId },
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

export async function confirmContentDraftAction(params: {
  tenantId: string;
  userId: string;
  actionId: string;
  expectedVersion: string;
  expectedStoreId: string | null;
  edits: ContentDraftEdit[];
}) {
  const action = await prisma.agentAction.findFirst({
    where: { id: params.actionId, tenantId: params.tenantId },
  });
  if (!action) return null;
  if (action.type !== "CONTENT_DRAFT" || action.status !== AgentActionStatus.PENDING_APPROVAL) {
    return action;
  }
  assertActionPreconditions(action, params);
  const payload = asRecord(action.payloadJson);
  const current = Array.isArray(payload.suggestions) ? payload.suggestions.map(asRecord) : [];
  const allowedFields = new Set(
    current
      .map((item) => stringField(item.field))
      .filter((field): field is string => field !== null),
  );
  const validation = validateContentDraftEdits(params.edits, allowedFields);
  if (!validation.success) {
    throw new AgentActionRequestError(
      "invalid_content_draft_edits",
      validation.error.message,
      [validation.error],
      400,
    );
  }
  const byField = new Map<string, string>(
    validation.edits.map((edit) => [edit.field, edit.suggestedRu]),
  );
  const next = current.map((item) => ({
    ...item,
    suggestedRu: byField.get(String(item.field)) ?? item.suggestedRu,
  }));
  const claimed = await prisma.agentAction.updateMany({
    where: {
      id: action.id,
      tenantId: params.tenantId,
      type: "CONTENT_DRAFT",
      status: AgentActionStatus.PENDING_APPROVAL,
      storeId: action.storeId,
      updatedAt: action.updatedAt,
    },
    data: {
      payloadJson: { ...payload, suggestions: next, editedByUser: true } as never,
      status: AgentActionStatus.APPROVED,
      approvedBy: params.userId,
      approvedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    return latestActionOrConflict(params, AgentActionStatus.PENDING_APPROVAL);
  }
  const updated = await prisma.agentAction.findFirst({
    where: { id: action.id, tenantId: params.tenantId },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: "agent.action.approved",
      entityType: "agent_action",
      entityId: action.id,
      metaJson: { type: action.type, confirmedVersion: params.expectedVersion } as never,
    },
  });
  return updated;
}

export async function rejectAgentAction(params: {
  tenantId: string;
  userId: string;
  actionId: string;
  reason?: string | null;
  expectedVersion: string;
  expectedStoreId: string | null;
}) {
  const action = await prisma.agentAction.findFirst({
    where: { id: params.actionId, tenantId: params.tenantId },
  });
  if (!action) return null;
  if (!["PENDING_APPROVAL", "RECOMMENDED"].includes(action.status)) return action;
  assertActionPreconditions(action, params);

  const claimed = await prisma.agentAction.updateMany({
    where: {
      id: action.id,
      tenantId: params.tenantId,
      status: action.status,
      updatedAt: action.updatedAt,
    },
    data: {
      status: AgentActionStatus.REJECTED,
      rejectedBy: params.userId,
      rejectedAt: new Date(),
      error: params.reason ?? action.error,
    },
  });
  if (claimed.count !== 1) return latestActionOrConflict(params, action.status);
  const updated = await prisma.agentAction.findFirst({
    where: { id: action.id, tenantId: params.tenantId },
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

async function resolveActionStore(action: { tenantId: string; storeId: string | null; payloadJson?: unknown }) {
  if (!action.storeId) throw new Error("missing_store_id");
  const payload = asRecord(action.payloadJson);
  consistentIdentity("store_id", [action.storeId, payload.storeId, payload.store_id, asRecord(payload.product).storeId]);
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
  const request = params.offerId
    ? { offerIds: [params.offerId] }
    : params.productId
      ? { productIds: [String(params.productId)] }
      : null;
  if (!request) throw new Error("missing_offer_id_or_product_id");
  const items = await params.client.getProductInfoList(request);
  const product = items[0] ?? null;
  if (!product) throw new Error("product_not_found_before_execution");
  assertProductIdentity(product, params);
  return product;
}

function assertProductIdentity(
  product: Pick<OzonProductInfoItem, "id" | "product_id" | "offer_id">,
  expected: { offerId?: string | null; productId?: number | null },
  allowMissingProductId = false,
) {
  const id = consistentIdentity("product_id", [product.id, product.product_id], true);
  if ((expected.offerId && product.offer_id !== expected.offerId)
    || (expected.productId != null && !(allowMissingProductId && id === null) && id !== String(expected.productId))) {
    throw new Error("product_identity_mismatch:live_product");
  }
}

function importTaskErrorMessage(error: Record<string, unknown>) {
  return [
    stringField(error.code) ?? "unknown",
    stringField(error.message) ?? stringField(error.description) ?? "unknown_error",
  ].join(":");
}

async function assertImportTaskSucceeded(params: {
  client: OzonClient;
  taskId: number | string;
  offerId?: string | null;
}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const info = await params.client.getProductImportInfo(params.taskId);
    const item = params.offerId
      ? info.items.find((candidate) => candidate.offer_id === params.offerId)
      : info.items[0];
    if (item) {
      const errors = (item.errors ?? [])
        .map(asRecord)
        .filter((error) => (stringField(error.level) ?? "error").toLowerCase() === "error");
      const firstError = errors[0];
      if (firstError) {
        throw new Error(`ozon_import_task_failed:${importTaskErrorMessage(firstError)}`);
      }
      if (item.status === "imported") return info;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(`ozon_import_task_not_ready:${params.taskId}`);
}

async function assertContentDraftApplied(params: {
  client: OzonClient;
  request: ImportProductsRequest;
  changedFields: string[];
  productId?: number | null;
}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const application = await readContentDraftApplication(params);
    if (application && !application.missingFields.length) {
      return { ...application, attempt };
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error("content_draft_not_reflected_after_import");
}

async function readContentDraftApplication(params: {
  client: OzonClient;
  request: { items: Array<{ offer_id: string; name?: string; description?: string }> };
  changedFields: string[];
  productId?: number | null;
}) {
  const item = params.request.items[0];
  const offerId = item?.offer_id;
  if (!offerId) return null;
  const expectedTitle = params.changedFields.includes("title") ? stringField(item.name) : null;
  const expectedDescription = params.changedFields.includes("description")
    ? stringField(item.description)
    : null;
  const [info] = await params.client.getProductInfoAttributes({ offerIds: [offerId] });
  if (!info) return null;
  assertProductIdentity(info, { offerId, productId: params.productId }, true);
  const actualTitle = stringField(info?.name);
  const directDescription = stringField(info?.description);
  const annotationDescription = attributeValueById(
    asRecord(info).attributes,
    OZON_DESCRIPTION_ATTRIBUTE_ID,
  );
  const actualDescription = directDescription ?? annotationDescription;
  const titleApplied = !expectedTitle || actualTitle === expectedTitle;
  const descriptionApplied = !expectedDescription || actualDescription === expectedDescription;
  const missingFields = [
    expectedTitle && !titleApplied ? "title" : "",
    expectedDescription && !descriptionApplied ? "description" : "",
  ].filter(Boolean);
  const appliedFields = params.changedFields.filter((field) => !missingFields.includes(field));
  return {
    offerId,
    titleApplied,
    descriptionApplied,
    appliedFields,
    missingFields,
    actualDescription,
    descriptionKnown: directDescription !== null || Array.isArray(info.attributes),
    descriptionSource: directDescription ? "description" : annotationDescription ? "attribute_4191" : null,
  };
}

async function recoverContentDraftAfterError(params: {
  client: OzonClient;
  action: { id: string; type: AgentActionType; guardrailJson: unknown; productId: string | null; payloadJson: unknown };
  request: ImportProductsRequest;
  changedFields: string[];
  error: unknown;
  importInfo?: unknown;
  response?: { task_id?: number | string | null };
  tenantId: string;
  userId: string;
}) {
  const application = await readContentDraftApplication({ ...params, productId: productIdFrom(params.action) }).catch(() => null);
  const execution = {
    kind: "CONTENT_DRAFT",
    recovery: "readback_after_error",
    changedFields: params.changedFields,
    request: params.request,
    appliedFields: application?.appliedFields ?? [],
    missingFields: application?.missingFields ?? params.changedFields,
    ozonTaskId: params.response?.task_id == null ? null : String(params.response.task_id),
    importInfo: params.importInfo ?? null,
    verification: application,
    error: params.error instanceof Error ? params.error.message : String(params.error),
  };
  if (!application?.appliedFields.length) {
    if (isUncertainOzonWriteError(params.error)
      || (params.response?.task_id != null && !(params.error instanceof Error && params.error.message.startsWith("ozon_import_task_failed:")))) {
      throw new ActionVerificationPendingError(execution);
    }
    return null;
  }
  if (!application.missingFields.length) {
    return markActionExecuted({
      tenantId: params.tenantId,
      userId: params.userId,
      action: params.action,
      execution,
    });
  }
  throw new ActionVerificationPendingError(execution);
}

class ActionVerificationPendingError extends Error {
  constructor(readonly execution: Record<string, unknown>) {
    super("result_pending_verification");
  }
}

async function verifyStockApplied(params: {
  client: OzonClient;
  offerId: string | null;
  productId: number | null;
  warehouseId: number;
  stock: number;
}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const items = await params.client.getProductStocks({
      ...(params.offerId ? { offerIds: [params.offerId] } : {}),
      ...(params.productId ? { productIds: [String(params.productId)] } : {}),
      limit: 100,
    });
    const product = items.find((item) =>
      params.offerId
        ? item.offer_id === params.offerId
        : String(item.product_id ?? "") === String(params.productId ?? ""),
    );
    const warehouseStock = product?.stocks?.find((item) =>
      item.warehouse_id === params.warehouseId || item.warehouse_ids?.includes(params.warehouseId),
    );
    if (warehouseStock?.present === params.stock) {
      return { attempt, warehouseId: params.warehouseId, stock: warehouseStock.present };
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new ActionVerificationPendingError({
    kind: "UPDATE_STOCK",
    phase: "verification_pending",
    offerId: params.offerId,
    productId: params.productId,
    warehouseId: params.warehouseId,
    stock: params.stock,
  });
}

async function verifyPriceApplied(params: {
  client: OzonClient;
  offerId: string;
  price: number;
}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const [product] = await params.client.getProductInfoList({ offerIds: [params.offerId] });
    const actual = numberField(product?.price ?? product?.marketing_price);
    if (actual === params.price) return { attempt, offerId: params.offerId, price: actual };
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new ActionVerificationPendingError({
    kind: "UPDATE_PRICE",
    phase: "verification_pending",
    offerId: params.offerId,
    price: params.price,
  });
}

function recoveryLeaseWhere(execution: Record<string, unknown>) {
  const leaseId = stringField(execution.recoveryLeaseId);
  return leaseId ? {
    status: AgentActionStatus.BLOCKED,
    error: "result_pending_verification",
    guardrailJson: { path: ["execution", "recoveryLeaseId"], equals: leaseId },
  } : {};
}

async function markActionExecuted(params: {
  tenantId: string;
  userId?: string;
  action: { id: string; type: AgentActionType; guardrailJson: unknown };
  execution: Record<string, unknown>;
}) {
  const updated = await prisma.agentAction.update({
    where: { id: params.action.id, tenantId: params.tenantId, ...recoveryLeaseWhere(params.execution) },
    data: {
      status: AgentActionStatus.EXECUTED,
      executedAt: new Date(),
      error: null,
      guardrailJson: {
        ...asRecord(params.action.guardrailJson),
        execution: { ...params.execution, phase: "finished" },
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
    where: { id: params.action.id, tenantId: params.tenantId },
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

async function markActionPendingVerification(params: {
  tenantId: string;
  action: { id: string; guardrailJson: unknown };
  execution: Record<string, unknown>;
}) {
  return prisma.agentAction.update({
    where: { id: params.action.id, tenantId: params.tenantId },
    data: {
      status: AgentActionStatus.BLOCKED,
      error: "result_pending_verification",
      guardrailJson: {
        ...asRecord(params.action.guardrailJson),
        execution: {
          ...params.execution,
          phase: "verification_pending",
          lastVerifiedAt: new Date().toISOString(),
        },
      } as never,
    },
  });
}

async function markActionPartial(params: {
  tenantId: string;
  userId?: string;
  action: { id: string; type: AgentActionType; guardrailJson: unknown };
  execution: Record<string, unknown>;
}) {
  const updated = await prisma.agentAction.update({
    where: { id: params.action.id, tenantId: params.tenantId, ...recoveryLeaseWhere(params.execution) },
    data: {
      status: AgentActionStatus.BLOCKED,
      error: "partial_execution",
      guardrailJson: {
        ...asRecord(params.action.guardrailJson),
        execution: { ...params.execution, phase: "manual_required" },
      } as never,
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: "agent.action.partial",
      entityType: "agent_action",
      entityId: params.action.id,
      metaJson: { type: params.action.type, execution: params.execution } as never,
    },
  });
  return updated;
}

async function executePublishDraftAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
  charge: () => Promise<void>;
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
  consistentIdentity("store_id", [action.storeId, payload.storeId, draft.storeId]);
  consistentIdentity("product_id", [action.productId, payload.productId, draft.productId]);
  const offerId = consistentIdentity("offer_id", [action.offerId, payload.offerId, draft.product.offerId]);
  if (draft.status !== "COMPILED") throw new Error("ozon_draft_not_compiled");
  if (!draft.store.ozonClientId || !draft.store.ozonApiKey) {
    throw new Error("ozon_store_not_configured");
  }
  const request = asRecord(draft.payloadJson);
  if (!Array.isArray(request.items) || request.items.length === 0) {
    throw new Error("invalid_draft_payload");
  }
  if (!action.storeId || request.items.length !== 1 || !offerId || asRecord(request.items[0]).offer_id !== offerId) {
    throw new Error("product_identity_mismatch:draft");
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
  const run = await claimPublishRun({
    tenantId: params.tenantId, draftId: draft.id, storeId: draft.storeId, requestHash, request,
  });
  await params.charge();
  let response;
  try {
    response = await client.importProducts(request as never);
    await prisma.publishRun.update({
      where: { id: run.id, tenantId: params.tenantId },
      data: { ozonTaskId: String(response.task_id), status: "submitted", responseJson: response as never },
    });
    await prisma.ozonDraft.update({
      where: { id: draft.id, tenantId: params.tenantId },
      data: { status: "SUBMITTED" },
    });
    await prisma.sourceProduct.update({
      where: { id: draft.productId, tenantId: params.tenantId },
      data: { status: "submitted" },
    });
    return await markActionExecuted({
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
  } catch (error) {
    throw new ActionVerificationPendingError({
      kind: "PUBLISH_DRAFT", publishRunId: run.id, requestHash, request,
      ozonTaskId: response?.task_id == null ? null : String(response.task_id),
      response: response ?? null, error: error instanceof Error ? error.message : String(error),
      manualMessage: "Check this publish run and Ozon task before any new submission; the request hash remains claimed.",
    });
  }
}

async function executeContentDraftAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const offerId = offerIdFrom(action);
  const productId = productIdFrom(action);
  const requestByIdentity = offerId
    ? { offerIds: [offerId] }
    : productId
      ? { productIds: [String(productId)] }
      : null;
  if (!requestByIdentity) throw new Error("missing_offer_id_or_product_id");
  const [infoItems, attributeItems] = await Promise.all([
    client.getProductInfoList(requestByIdentity),
    client.getProductInfoAttributes(requestByIdentity),
  ]);
  const info = infoItems[0] ?? null;
  const attributes = attributeItems[0] ?? null;
  if (!info) throw new Error("product_not_found_before_execution");
  assertProductIdentity(info, { offerId, productId });
  if (attributes) assertProductIdentity(attributes, { offerId, productId }, true);
  const latestProduct: OzonProductInfoItem = {
    ...(attributes ?? {}),
    ...(info ?? {}),
    ...((attributes?.attributes ?? info?.attributes) === undefined
      ? {}
      : { attributes: attributes?.attributes ?? info?.attributes }),
    ...((attributes?.description ?? info?.description) === undefined
      ? {}
      : { description: attributes?.description ?? info?.description }),
    ...((attributes?.description_category_id ?? info?.description_category_id) === undefined
      ? {}
      : { description_category_id: attributes?.description_category_id ?? info?.description_category_id }),
    ...((attributes?.type_id ?? info?.type_id) === undefined
      ? {}
      : { type_id: attributes?.type_id ?? info?.type_id }),
    ...((attributes?.weight ?? info?.weight) === undefined
      ? {}
      : { weight: attributes?.weight ?? info?.weight }),
    ...((attributes?.width ?? info?.width) === undefined
      ? {}
      : { width: attributes?.width ?? info?.width }),
    ...((attributes?.height ?? info?.height) === undefined
      ? {}
      : { height: attributes?.height ?? info?.height }),
    ...((attributes?.depth ?? info?.depth) === undefined
      ? {}
      : { depth: attributes?.depth ?? info?.depth }),
  };
  const conflicts = contentDraftFieldConflicts(action, latestProduct);
  if (conflicts.length) {
    throw new Error(`content_draft_stale_target_fields:${conflicts.join(",")}`);
  }
  const { request, changedFields } = contentDraftImportPayload(action, latestProduct);
  const requestHash = computeRequestHash(store.id, request);
  let response: { task_id?: number | string | null } | undefined;
  let importInfo: unknown;
  let verification: unknown;
  try {
    response = await client.importProducts(request);
    importInfo = await assertImportTaskSucceeded({
      client,
      taskId: response.task_id!,
      offerId: request.items[0]?.offer_id,
    });
    verification = await assertContentDraftApplied({ client, request, changedFields, productId });
  } catch (error) {
    const recovered = await recoverContentDraftAfterError({
      client,
      action,
      request,
      changedFields,
      error,
      importInfo,
      response,
      tenantId: params.tenantId,
      userId: params.userId,
    });
    if (recovered) return recovered;
    throw error;
  }
  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "CONTENT_DRAFT",
      ozonTaskId: String(response.task_id),
      requestHash,
      changedFields,
      importInfo,
      verification,
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
  const offerId = offerIdFrom(action);
  const proposedPriceRub = numberField(payload.proposedPriceRub);
  if (!offerId) throw new Error("missing_offer_id");
  if (!proposedPriceRub || proposedPriceRub <= 0) throw new Error("missing_or_invalid_price");
  const client = ozonClientForStore(store);
  await verifyCurrentProduct({ client, offerId, productId: productIdFrom(action) });
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
  assertOzonMutationNotRejected(response.raw, [{ offerId }]);
  const verification = await verifyPriceApplied({
    client,
    offerId,
    price: proposedPriceRub,
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
      verification,
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
  const businessResult = assertOzonMutationSucceeded(response.raw, [{ offerId, productId }]);
  const verification = await verifyStockApplied({
    client,
    offerId,
    productId,
    warehouseId,
    stock,
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
      businessResult,
      verification,
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
  await verifyCurrentProduct({ client, offerId: offerIdFrom(action), productId });

  const response = await client.importPictures({
    product_id: productId,
    images,
    ...(images360.length ? { images360 } : {}),
    ...(colorImage ? { color_image: colorImage } : {}),
  });
  const businessResult = assertOzonMutationSucceeded(response.raw, [{ productId }]);

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "UPDATE_IMAGES",
      productId,
      imageCount: images.length,
      businessResult,
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
  const businessResult = assertOzonMutationSucceeded(response.raw, [{ offerId, productId }]);

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "UPDATE_ATTRIBUTES",
      offerId,
      productId,
      attributeCount: attributes.length,
      businessResult,
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
  const product = await verifyCurrentProduct({
    client,
    offerId: offerIdFrom(action) ?? stringField(request.items[0]?.offer_id),
    productId: productIdFrom(action),
  });
  if (request.items.length !== 1 || request.items[0]?.offer_id !== product.offer_id) {
    throw new Error("product_identity_mismatch:import_payload");
  }
  assertProductIdentity(asRecord(request.items[0]), {
    offerId: product.offer_id, productId: numberField(product.id ?? product.product_id),
  }, true);
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
  const businessResult = assertOzonMutationSucceeded(response.raw, [{ offerId, productId }]);

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: "DELETE_PRODUCT",
      offerId,
      productId,
      businessResult,
      response: response.raw,
    },
  });
}

function bulkExecution(results: Record<string, unknown>[]) {
  return {
    kind: "BULK_PRODUCT_UPDATE",
    total: results.length,
    executed: results.filter((item) => item.status === "executed").length,
    failed: results.filter((item) => item.status === "failed").length,
    pending: results.filter((item) => item.status === "pending_verification").length,
    results,
  };
}

async function executeBulkProductUpdateAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const payload = asRecord(action.payloadJson);
  validateCompetitorBatchPayload(payload);
  const items = recordArray(payload.items);
  if (!items.length) throw new Error("missing_bulk_items");
  if (items.length > 50) throw new Error("bulk_item_limit_exceeded");

  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const approvedOfferId = offerIdFrom(action);
  const approvedProductId = productIdFrom(action);
  const startedAt = new Date().toISOString();
  const results: Array<{
    index: number;
    type: string | null;
    offerId: string | null;
    productId: number | null;
    status: "executed" | "failed" | "pending_verification";
    payload: Record<string, unknown>;
    writeAttempted: boolean;
    response?: unknown;
    verification?: unknown;
    error?: string;
  }> = [];
  const checkpoint = async (current = results) => {
    await prisma.agentAction.update({
      where: { id: action.id, tenantId: params.tenantId },
      data: { guardrailJson: { ...asRecord(action.guardrailJson), execution: {
        ...bulkExecution(current), phase: "executing", startedAt,
      } } as never },
    });
  };

  for (const [index, item] of items.entries()) {
    const type = stringField(item.type ?? item.actionType);
    let offerId = stringField(item.offerId ?? item.offer_id);
    let productId = numberField(item.productId ?? item.product_id);
    let writeAttempted = false;
    let response: { raw: unknown } | undefined;
    let verification: unknown;
    const beforeWrite = async () => {
      await checkpoint([...results, { index, type, offerId, productId, payload: item, writeAttempted: true, status: "pending_verification" }]);
      writeAttempted = true;
    };
    try {
      consistentIdentity("store_id", [store.id, item.storeId, item.store_id, asRecord(item.product).storeId]);
      productId = productIdFrom({ productId: approvedProductId == null ? null : String(approvedProductId), payloadJson: item });
      offerId = offerIdFrom({ offerId: approvedOfferId, payloadJson: item });
      await verifyCurrentProduct({ client, offerId, productId });

      if (type === "UPDATE_STOCK") {
        const stock = numberField(item.stock);
        const warehouseId = numberField(item.warehouseId ?? item.warehouse_id);
        if (stock == null || stock < 0) throw new Error("missing_or_invalid_stock");
        if (!warehouseId) throw new Error("missing_warehouse_id");
        await beforeWrite();
        response = await client.updateStocks({
          stocks: [{ ...(offerId ? { offer_id: offerId } : {}), ...(productId ? { product_id: productId } : {}), stock, warehouse_id: warehouseId }],
        });
        assertOzonMutationSucceeded(response.raw, [{ offerId, productId }]);
        verification = await verifyStockApplied({ client, offerId, productId, warehouseId, stock });
      } else if (type === "UPDATE_IMAGES") {
        if (!productId) throw new Error("missing_product_id");
        const images = stringArray(item.images);
        if (!images.length) throw new Error("missing_images");
        await beforeWrite();
        response = await client.importPictures({ product_id: productId, images });
        assertOzonMutationSucceeded(response.raw, [{ productId }]);
      } else if (type === "UPDATE_ATTRIBUTES") {
        const attributes = attributesFromPayload(item.attributes);
        if (!attributes) throw new Error("missing_attributes");
        await beforeWrite();
        response = await client.updateAttributes({
          items: [{ ...(offerId ? { offer_id: offerId } : {}), ...(productId ? { product_id: productId } : {}), attributes }],
        });
        assertOzonMutationSucceeded(response.raw, [{ offerId, productId }]);
      } else if (type === "DELETE_PRODUCT") {
        if (!offerId && !productId) throw new Error("missing_offer_id_or_product_id");
        await beforeWrite();
        response = await client.deleteProducts({
          products: [{ ...(offerId ? { offer_id: offerId } : {}), ...(productId ? { product_id: productId } : {}) }],
        });
        assertOzonMutationSucceeded(response.raw, [{ offerId, productId }]);
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
        await beforeWrite();
        response = await client.importPrices({
          prices: [{ offer_id: offerId, price: String(price), old_price: stringField(item.oldPriceRub) ?? "0", currency_code: "RUB" }],
        });
        assertOzonMutationNotRejected(response.raw, [{ offerId }]);
        verification = await verifyPriceApplied({ client, offerId, price });
      } else {
        throw new Error("unsupported_bulk_item_type");
      }
      results.push({ index, type, offerId, productId, payload: item, writeAttempted, response: response?.raw ?? null, verification: verification ?? null, status: "executed" });
    } catch (error) {
      results.push({
        index,
        type,
        offerId,
        productId,
        payload: item,
        writeAttempted,
        response: response?.raw ?? null,
        verification: error instanceof ActionVerificationPendingError ? error.execution : null,
        status: error instanceof ActionVerificationPendingError || (writeAttempted && isUncertainOzonWriteError(error)) ? "pending_verification" : "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await checkpoint();
    } catch (error) {
      throw new ActionVerificationPendingError({ ...bulkExecution(results), error: String(error) });
    }
  }

  const failed = results.filter((item) => item.status === "failed");
  const pending = results.filter((item) => item.status === "pending_verification");
  if (failed.length === results.length) {
    throw new Error("bulk_all_items_failed");
  }

  const execution = bulkExecution(results);
  if (pending.length) {
    return markActionPendingVerification({ tenantId: params.tenantId, action, execution });
  }
  if (failed.length) {
    return markActionPartial({
      tenantId: params.tenantId,
      userId: params.userId,
      action,
      execution,
    });
  }

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution,
  });
}

async function executeArchiveAction(params: {
  tenantId: string;
  userId: string;
  action: Awaited<ReturnType<typeof prisma.agentAction.findFirst>>;
}) {
  const action = params.action!;
  const store = await resolveActionStore(action);
  const productId = productIdFrom(action);
  if (!productId) throw new Error("missing_product_id");
  const client = ozonClientForStore(store);
  await verifyCurrentProduct({ client, offerId: offerIdFrom(action), productId });
  const response =
    action.type === "ARCHIVE_PRODUCT"
      ? await client.archiveProducts({ product_id: [productId] })
      : await client.unarchiveProducts({ product_id: [productId] });
  const businessResult = assertOzonMutationSucceeded(response.raw, [{ productId }]);

  return markActionExecuted({
    tenantId: params.tenantId,
    userId: params.userId,
    action,
    execution: {
      kind: action.type,
      productId,
      businessResult,
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
  if (!promotionPriceRuleSchema.safeParse(payload.priceRule).success) {
    throw new Error("invalid_promotion_price_rule");
  }
  if (!promotionScopeSchema.safeParse(payload.scope).success) {
    throw new Error("invalid_promotion_scope");
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
    ? [...new Set(payload.productIds.map((id) => {
      const parsed = consistentIdentity("product_id", [id], true);
      if (!parsed) throw new Error("invalid_product_id");
      return Number(parsed);
    }))]
    : [];
  if (!action.storeId) throw new Error("missing_store_id");
  if (!actionId) throw new Error("missing_promotion_action_id");
  if (!policyActionId) throw new Error("missing_promotion_policy_action_id");
  if (!productIds.length || productIds.length > 20) {
    throw new Error("invalid_promotion_product_ids");
  }
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const approvedProductId = productIdFrom(action);
  const offerId = offerIdFrom(action);
  if ((approvedProductId || offerId) && (productIds.length !== 1 || (approvedProductId && productIds[0] !== approvedProductId))) {
    throw new Error("product_identity_mismatch:promotion");
  }
  for (const productId of productIds) {
    consistentIdentity("product_id", [productId], true);
    await verifyCurrentProduct({ client, offerId, productId });
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

  const startedAt = new Date();
  const executionLease = {
    phase: "executing",
    leaseId: randomUUID(),
    startedAt: startedAt.toISOString(),
    heartbeatAt: startedAt.toISOString(),
    leaseExpiresAt: new Date(startedAt.getTime() + 120_000).toISOString(),
    confirmedVersion: action.updatedAt?.toISOString() ?? null,
    retryCount: 0,
  };
  const claim = await prisma.agentAction.updateMany({
    where: {
      id: action.id,
      tenantId: params.tenantId,
      status: AgentActionStatus.APPROVED,
    },
    data: {
      status: AgentActionStatus.BLOCKED,
      error: "execution_in_progress",
      guardrailJson: {
        ...asRecord(action.guardrailJson),
        execution: executionLease,
      } as never,
    },
  });
  if (claim.count !== 1) {
    return prisma.agentAction.findFirst({
      where: { id: action.id, tenantId: params.tenantId },
    });
  }
  const creditReference = {
    referenceType: "agent_action_execute",
    referenceId: action.id,
    idempotencyKey: `agent-action-execute:${action.id}`,
  };
  let charged = false;
  const heartbeat = setInterval(() => {
    const heartbeatAt = new Date();
    void prisma.agentAction.updateMany({
      where: {
        id: action.id,
        tenantId: params.tenantId,
        status: AgentActionStatus.BLOCKED,
        error: "execution_in_progress",
      },
      data: {
        // Heartbeats must not overwrite per-item write evidence saved during execution.
        updatedAt: heartbeatAt,
      },
    }).catch(() => null);
  }, 15_000);
  heartbeat.unref?.();
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
    assertRealOzonSubmitEnabled(action.type);
    const charge = async () => {
      await consumeTenantCredits({
        tenantId: params.tenantId,
        feature: "ozon_action_execute",
        createdBy: params.userId,
        ...creditReference,
      });
      charged = true;
    };
    if (action.type === "PUBLISH_DRAFT") {
      return await executePublishDraftAction({ ...params, action, charge });
    }
    if (requiresRealOzonSubmit(action.type)) {
      await charge();
    }
    if (action.type === "PROMOTION_POLICY") {
      return await executePromotionPolicyAction({ ...params, action });
    }
    if (action.type === "PROMOTION_ENROLLMENT") {
      return await executePromotionEnrollmentAction({ ...params, action });
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
    if (error instanceof ActionVerificationPendingError) {
      return markActionPendingVerification({
        tenantId: params.tenantId,
        action,
        execution: { ...executionLease, ...error.execution },
      });
    }
    if (requiresRealOzonSubmit(action.type) && isUncertainOzonWriteError(error)) {
      return markActionPendingVerification({
        tenantId: params.tenantId,
        action,
        execution: {
          ...executionLease,
          kind: action.type,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
    if (charged) {
      await refundTenantCredits({
        tenantId: params.tenantId,
        feature: "ozon_action_execute",
        createdBy: params.userId,
        referenceType: creditReference.referenceType,
        referenceId: creditReference.referenceId,
        idempotencyKey: `refund:${creditReference.idempotencyKey}`,
      }).catch(() => null);
    }
    return markActionFailed({
      tenantId: params.tenantId,
      userId: params.userId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearInterval(heartbeat);
  }
}

async function readRecoveredActionApplied(
  action: NonNullable<Awaited<ReturnType<typeof prisma.agentAction.findFirst>>>,
) {
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const payload = asRecord(action.payloadJson);
  const offerId = offerIdFrom(action);
  const productId = productIdFrom(action);
  const product = await verifyCurrentProduct({ client, offerId, productId });

  if (action.type === "UPDATE_PRICE" && offerId) {
    const expected = numberField(payload.proposedPriceRub ?? payload.price);
    const actual = numberField(product?.price ?? product?.marketing_price);
    return expected != null && actual === expected;
  }
  if (action.type === "UPDATE_STOCK") {
    const warehouseId = numberField(payload.warehouseId ?? payload.warehouse_id);
    const expected = numberField(payload.stock);
    if (!warehouseId || expected == null) return null;
    const products = await client.getProductStocks({
      ...(offerId ? { offerIds: [offerId] } : {}),
      ...(productId ? { productIds: [String(productId)] } : {}),
      limit: 100,
    });
    const product = products.find((item) =>
      offerId ? item.offer_id === offerId : String(item.product_id ?? "") === String(productId ?? ""),
    );
    if (product) assertProductIdentity(product, { offerId, productId });
    const stock = product?.stocks?.find((item) =>
      item.warehouse_id === warehouseId || item.warehouse_ids?.includes(warehouseId),
    );
    return stock ? stock.present === expected : false;
  }
  if (action.type === "CONTENT_DRAFT" && offerId) {
    const edits = Array.isArray(payload.suggestions) ? payload.suggestions.map(asRecord) : [];
    const expectedTitle = stringField(edits.find((item) => item.field === "title")?.suggestedRu);
    const expectedDescription = stringField(
      edits.find((item) => item.field === "description")?.suggestedRu,
    );
    const [product] = await client.getProductInfoAttributes({ offerIds: [offerId] });
    if (!product) return null;
    assertProductIdentity(product, { offerId, productId }, true);
    const actualDescription = stringField(product?.description) ?? attributeValueById(
      asRecord(product).attributes,
      OZON_DESCRIPTION_ATTRIBUTE_ID,
    );
    return (!expectedTitle || stringField(product?.name) === expectedTitle)
      && (!expectedDescription || actualDescription === expectedDescription);
  }
  return null;
}

async function recoverContentDraft(
  action: NonNullable<Awaited<ReturnType<typeof prisma.agentAction.findFirst>>>,
  recovery: Record<string, unknown>,
) {
  const store = await resolveActionStore(action);
  const client = ozonClientForStore(store);
  const offerId = offerIdFrom(action);
  const productId = productIdFrom(action);
  const payload = asRecord(action.payloadJson);
  const changedFields = supportedContentDraftFields(payload);
  const request = { items: [{
    offer_id: offerId ?? "",
    name: contentSuggestionValue(payload, "title") ?? undefined,
    description: contentSuggestionValue(payload, "description") ?? undefined,
  }] };
  const taskId = stringField(recovery.ozonTaskId);
  const task = taskId ? await client.getProductImportInfo(taskId).catch(() => null) : null;
  const taskItem = task?.items.find((item) => item.offer_id === offerId);
  if (taskItem) assertProductIdentity(taskItem, { offerId, productId }, true);
  await verifyCurrentProduct({ client, offerId, productId });
  const read = () => readContentDraftApplication({ client, request, changedFields, productId });
  const application = await read();
  const evidence = {
    ...recovery, importInfo: task ?? null, verification: application,
    appliedFields: application?.appliedFields ?? [], missingFields: application?.missingFields ?? changedFields,
    manualMessage: "Check the Ozon task and the listed missing fields in this store. Do not resubmit the full action; resolve conflicts manually within the approved fields.",
  };
  if (application && changedFields.length && !application.missingFields.length) {
    return { applied: true, execution: evidence };
  }
  const originalDescription = stringField(recordArray(payload.suggestions).find((item) => item.field === "description")?.current)
    ?? stringField(asRecord(asRecord(payload.product).rawInfo).description)
    ?? attributeValueById(asRecord(asRecord(payload.product).rawInfo).attributes, OZON_DESCRIPTION_ATTRIBUTE_ID);
  const canRetry = (current: typeof application) => Boolean(
    current?.titleApplied && current.missingFields.length === 1 && current.missingFields[0] === "description"
    && current.descriptionKnown && (current.actualDescription === null || current.actualDescription === originalDescription),
  );
  if (!offerId || !changedFields.includes("description") || !canRetry(application)
    || taskItem?.status !== "imported" || (taskItem.errors ?? []).length
    || (numberField(recovery.writeRetryCount) ?? 0) >= 1 || process.env.ENABLE_REAL_OZON_SUBMIT !== "true") {
    return { applied: false, execution: evidence };
  }
  // Re-read before the one field-only retry; a concurrent edit must not be overwritten.
  if (!canRetry(await read())) return { applied: false, execution: evidence };
  const retry = { ...evidence, writeRetryCount: 1, retriedFields: ["description"] };
  const claim = await prisma.agentAction.updateMany({
    where: {
      id: action.id, tenantId: action.tenantId, status: AgentActionStatus.BLOCKED,
      error: "result_pending_verification",
      guardrailJson: { path: ["execution", "recoveryLeaseId"], equals: recovery.recoveryLeaseId as string },
    },
    data: { guardrailJson: { ...asRecord(action.guardrailJson), execution: retry } as never },
  });
  if (claim.count !== 1) return { applied: false, execution: evidence };
  let response: unknown = null;
  let errorMessage: string | null = null;
  try {
    response = await client.updateAttributes({ items: [{
      offer_id: offerId, ...(productId ? { product_id: productId } : {}),
      attributes: [{ id: OZON_DESCRIPTION_ATTRIBUTE_ID, values: [{ value: request.items[0]!.description! }] }],
    }] });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  const verified = await read().catch(() => null);
  return {
    applied: Boolean(verified && !verified.missingFields.length),
    execution: {
      ...retry, retryResponse: response, retryError: errorMessage, verification: verified,
      appliedFields: verified?.appliedFields ?? evidence.appliedFields,
      missingFields: verified?.missingFields ?? evidence.missingFields,
    },
  };
}

export async function recoverBlockedAgentAction(params: {
  tenantId: string;
  userId?: string;
  actionId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const action = await prisma.agentAction.findFirst({
    where: { id: params.actionId, tenantId: params.tenantId },
  });
  if (!action || action.status !== AgentActionStatus.BLOCKED) return action;
  if (!["execution_in_progress", "result_pending_verification"].includes(action.error ?? "")) {
    return action;
  }
  if (
    action.error === "execution_in_progress"
    && now.getTime() - action.updatedAt.getTime() < 120_000
  ) {
    return action;
  }

  const previous = asRecord(asRecord(action.guardrailJson).execution);
  if (Date.parse(stringField(previous.recoveryLeaseExpiresAt) ?? "") > now.getTime()) return action;
  const retryCount = (numberField(previous.retryCount) ?? 0) + 1;
  let recovery: Record<string, unknown> = {
    ...previous,
    phase: "verification_pending",
    recovery: "readback",
    retryCount,
    lastVerifiedAt: now.toISOString(),
    recoveryLeaseId: randomUUID(),
    recoveryLeaseExpiresAt: new Date(now.getTime() + 120_000).toISOString(),
  };
  const claimed = await prisma.agentAction.updateMany({
    where: {
      id: action.id,
      tenantId: params.tenantId,
      status: AgentActionStatus.BLOCKED,
      updatedAt: action.updatedAt,
    },
    data: {
      error: "result_pending_verification",
      guardrailJson: {
        ...asRecord(action.guardrailJson),
        execution: recovery,
      } as never,
    },
  });
  if (claimed.count !== 1) {
    return prisma.agentAction.findFirst({
      where: { id: action.id, tenantId: params.tenantId },
    });
  }

  let applied: boolean | null = false;
  try {
    if (action.type === "CONTENT_DRAFT") {
      const result = await recoverContentDraft(action, recovery);
      recovery = result.execution;
      applied = result.applied;
    } else if (action.type === "BULK_PRODUCT_UPDATE") {
      const results = [];
      for (const item of recordArray(previous.results)) {
        if (item.status !== "pending_verification") { results.push(item); continue; }
        const verified = await readRecoveredActionApplied({
          ...action, type: item.type as AgentActionType,
          offerId: stringField(item.offerId), productId: stringField(item.productId),
          payloadJson: (item.payload ?? recordArray(asRecord(action.payloadJson).items)[Number(item.index)]) as never,
        }).catch(() => null);
        results.push(verified ? { ...item, status: "executed", verification: "readback", error: null } : item);
      }
      recovery = { ...recovery, ...bulkExecution(results) };
      const complete = results.length === recordArray(asRecord(action.payloadJson).items).length;
      applied = complete && results.length > 0 && results.every((item) => item.status === "executed");
      if (complete && results.length && !recovery.pending && recovery.failed) {
        return markActionPartial({ ...params, action, execution: { ...recovery, recoveryLeaseExpiresAt: null } });
      }
    } else {
      applied = await readRecoveredActionApplied(action);
    }
  } catch (error) {
    recovery = { ...recovery, verificationError: error instanceof Error ? error.message : String(error) };
  }
  recovery = { ...recovery, recoveryLeaseExpiresAt: null };
  if (applied) {
    return markActionExecuted({
      tenantId: params.tenantId,
      userId: params.userId,
      action,
      execution: recovery,
    });
  }
  const startedAt = Date.parse(stringField(previous.startedAt) ?? action.updatedAt.toISOString());
  const expired = retryCount >= 10 || now.getTime() - startedAt >= 10 * 60_000;
  return prisma.agentAction.update({
    where: { id: action.id, tenantId: params.tenantId, ...recoveryLeaseWhere(recovery) },
    data: {
      status: AgentActionStatus.BLOCKED,
      error: expired ? "verification_expired" : "result_pending_verification",
      guardrailJson: {
        ...asRecord(action.guardrailJson),
        execution: {
          ...recovery,
          phase: expired ? "manual_required" : "verification_pending",
          manualMessage: recovery.manualMessage ?? "Check this store's Ozon task and saved per-item results. Do not resubmit successful or uncertain items; resolve the missing fields manually.",
        },
      } as never,
    },
  });
}
