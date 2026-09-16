import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  agentAction: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  store: {
    findFirst: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

const activatePromotionEnrollment = vi.hoisted(() => vi.fn());
const consumeTenantCredits = vi.hoisted(() => vi.fn());
const refundTenantCredits = vi.hoisted(() => vi.fn());
const ozonClientMock = vi.hoisted(() => ({
  getProductInfoList: vi.fn(),
  importProducts: vi.fn(),
}));

vi.mock("@saas/db", () => ({
  prisma,
  decryptSecret: vi.fn((value: string) => value),
  AgentActionStatus: {
    APPROVED: "APPROVED",
    EXECUTED: "EXECUTED",
    FAILED: "FAILED",
    PENDING_APPROVAL: "PENDING_APPROVAL",
    RECOMMENDED: "RECOMMENDED",
    BLOCKED: "BLOCKED",
  },
  AgentRiskLevel: {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
  },
}));

vi.mock("./promotions", () => ({ activatePromotionEnrollment }));
vi.mock("@/lib/credits", () => ({ consumeTenantCredits, refundTenantCredits }));
vi.mock("@saas/ozon", () => ({
  OzonClient: vi.fn(function OzonClient() {
    return ozonClientMock;
  }),
  computeRequestHash: vi.fn(() => "request-hash"),
  checkSubmitGuards: vi.fn(() => undefined),
}));

import {
  contentDraftImportPayload,
  executeApprovedAgentAction,
  validateCompetitorBatchPayload,
} from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  prisma.agentAction.updateMany.mockResolvedValue({ count: 1 });
  prisma.store.findFirst.mockResolvedValue({
    id: "store-1",
    ozonClientId: "client-1",
    ozonApiKey: "plain-key",
  });
  ozonClientMock.getProductInfoList.mockResolvedValue([{ id: 1 }]);
  ozonClientMock.importProducts.mockResolvedValue({ task_id: 123 });
  consumeTenantCredits.mockResolvedValue({
    account: { balance: 90 },
    transaction: { id: "credit-1" },
    idempotentReplay: false,
  });
  refundTenantCredits.mockResolvedValue({
    account: { balance: 100 },
    transaction: { id: "refund-1" },
    idempotentReplay: false,
  });
  process.env.ENABLE_REAL_OZON_SUBMIT = "false";
});

describe("executeApprovedAgentAction", () => {
  it("uses the annotation attribute as description for title-only content drafts", () => {
    const { request, changedFields } = contentDraftImportPayload({
      offerId: "SKU-1",
      payloadJson: {
        suggestions: [{
          field: "title",
          suggestedRu: "Новое название",
        }],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Старое название",
            description_category_id: 200000933,
            type_id: 93194,
            price: "129.00",
            old_price: "269.00",
            vat: "0",
            images: ["https://example.com/1.jpg"],
            attributes: [
              { id: 4191, values: [{ value: "Описание из аннотации" }] },
            ],
            weight: 300,
            width: 200,
            height: 10,
            depth: 300,
          },
        },
      },
    });

    expect(changedFields).toEqual(["title"]);
    expect(request.items[0]?.name).toBe("Новое название");
    expect(request.items[0]?.description).toBe("Описание из аннотации");
  });

  it("verifies content drafts with offerId only when productId is also present", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "content-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: "5853386614",
      type: "CONTENT_DRAFT",
      status: "APPROVED",
      guardrailJson: {},
      payloadJson: {
        suggestions: [{
          field: "title",
          suggestedRu: "Новое название",
        }],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Старое название",
            description_category_id: 200000933,
            type_id: 93194,
            price: "129.00",
            old_price: "269.00",
            vat: "0",
            images: ["https://example.com/1.jpg"],
            attributes: [
              { id: 4191, values: [{ value: "Описание из аннотации" }] },
            ],
            weight: 300,
            width: 200,
            height: 10,
            depth: 300,
          },
        },
      },
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "content-1",
      type: "CONTENT_DRAFT",
      status: "EXECUTED",
    });

    await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "content-1",
    });

    expect(ozonClientMock.getProductInfoList).toHaveBeenCalledWith({ offerIds: ["SKU-1"] });
    expect(ozonClientMock.importProducts).toHaveBeenCalled();
    expect(consumeTenantCredits).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      feature: "ozon_action_execute",
      createdBy: "user-1",
      referenceType: "agent_action_execute",
      referenceId: "content-1",
      idempotencyKey: "agent-action-execute:content-1",
    });
    expect(refundTenantCredits).not.toHaveBeenCalled();
  });

  it("refunds action execution credits when the Ozon write fails", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "content-failed",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: "5853386614",
      type: "CONTENT_DRAFT",
      status: "APPROVED",
      guardrailJson: {},
      payloadJson: {
        suggestions: [{
          field: "title",
          suggestedRu: "Новое название",
        }],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Старое название",
            description_category_id: 200000933,
            type_id: 93194,
            price: "129.00",
            old_price: "269.00",
            vat: "0",
            images: ["https://example.com/1.jpg"],
            attributes: [{ id: 4191, values: [{ value: "Описание" }] }],
            weight: 300,
            width: 200,
            height: 10,
            depth: 300,
          },
        },
      },
    });
    ozonClientMock.importProducts.mockRejectedValue(new Error("ozon_down"));
    prisma.agentAction.update.mockResolvedValue({
      id: "content-failed",
      type: "CONTENT_DRAFT",
      status: "FAILED",
      error: "ozon_down",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "content-failed",
    });

    expect(result?.status).toBe("FAILED");
    expect(consumeTenantCredits).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      feature: "ozon_action_execute",
      createdBy: "user-1",
      referenceType: "agent_action_execute",
      referenceId: "content-failed",
      idempotencyKey: "agent-action-execute:content-failed",
    });
    expect(refundTenantCredits).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      feature: "ozon_action_execute",
      createdBy: "user-1",
      referenceType: "agent_action_execute",
      referenceId: "content-failed",
      idempotencyKey: "refund:agent-action-execute:content-failed",
    });
  });

  it("requires the approved competitor preview to match the exact Ozon attributes", () => {
    const payload = {
      source: "competitor_attribute_playbook",
      recommendations: [{
        offerId: "SKU-1",
        ozonAttributeId: 10,
        suggestedValue: "Хлопок",
        dictionaryValueId: 1001,
      }],
      items: [{
        type: "UPDATE_ATTRIBUTES",
        offerId: "SKU-1",
        productId: "44",
        attributes: [{ id: 10, values: [{ value: "Хлопок", dictionaryValueId: 1001 }] }],
      }],
    };

    expect(() => validateCompetitorBatchPayload(payload)).not.toThrow();
    expect(() => validateCompetitorBatchPayload({
      ...payload,
      items: [{
        ...payload.items[0],
        attributes: [{ id: 10, values: [{ value: "Полиэстер", dictionaryValueId: 1001 }] }],
      }],
    })).toThrow("competitor_batch_preview_mismatch");
    expect(() => validateCompetitorBatchPayload({
      ...payload,
      items: [{ ...payload.items[0], type: "UPDATE_PRICE" }],
    })).toThrow("competitor_batch_attributes_only");
  });

  it("blocks approved content drafts when real Ozon writes are disabled", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "action-1",
      tenantId: "tenant-1",
      type: "CONTENT_DRAFT",
      status: "APPROVED",
      guardrailJson: {},
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "action-1",
      type: "CONTENT_DRAFT",
      status: "FAILED",
      error: "real_ozon_submit_disabled",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "action-1",
    });

    expect(result?.status).toBe("FAILED");
    expect(prisma.agentAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: {
        status: "FAILED",
        error: "real_ozon_submit_disabled",
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "agent.action.failed" }),
      }),
    );
  });

  it("does not execute unapproved actions", async () => {
    const action = {
      id: "action-1",
      type: "CONTENT_DRAFT",
      status: "PENDING_APPROVAL",
    };
    prisma.agentAction.findFirst.mockResolvedValue(action);

    await expect(
      executeApprovedAgentAction({
        tenantId: "tenant-1",
        userId: "user-1",
        actionId: "action-1",
      }),
    ).resolves.toBe(action);
    expect(prisma.agentAction.update).not.toHaveBeenCalled();
  });

  it("blocks approved price updates when real Ozon writes are disabled", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "action-2",
      tenantId: "tenant-1",
      type: "UPDATE_PRICE",
      status: "APPROVED",
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "action-2",
      type: "UPDATE_PRICE",
      status: "FAILED",
      error: "real_ozon_submit_disabled",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "action-2",
    });

    expect(result?.status).toBe("FAILED");
    expect(prisma.agentAction.update).toHaveBeenCalledWith({
      where: { id: "action-2" },
      data: {
        status: "FAILED",
        error: "real_ozon_submit_disabled",
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "agent.action.failed" }),
      }),
    );
    expect(consumeTenantCredits).not.toHaveBeenCalled();
  });

  it("activates a confirmed promotion policy locally", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "policy-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      type: "PROMOTION_POLICY",
      status: "APPROVED",
      payloadJson: {
        sop: "库存至少 5 件",
        rule: { all: [{ field: "stock", operator: "gte", value: 5 }] },
        priceRule: { mode: "multiplier", value: 0.9 },
      },
      guardrailJson: {},
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "policy-1",
      type: "PROMOTION_POLICY",
      status: "EXECUTED",
    });

    await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "policy-1",
    });

    expect(activatePromotionEnrollment).not.toHaveBeenCalled();
    expect(prisma.agentAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "policy-1" },
        data: expect.objectContaining({ status: "EXECUTED" }),
      }),
    );
  });

  it("rejects a promotion policy without a safe price rule", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "policy-bad",
      tenantId: "tenant-1",
      storeId: "store-1",
      type: "PROMOTION_POLICY",
      status: "APPROVED",
      payloadJson: {
        sop: "库存至少 5 件",
        rule: { all: [{ field: "stock", operator: "gte", value: 5 }] },
      },
      guardrailJson: {},
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "policy-bad",
      type: "PROMOTION_POLICY",
      status: "FAILED",
    });

    await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "policy-bad",
    });

    expect(prisma.agentAction.update).toHaveBeenCalledWith({
      where: { id: "policy-bad" },
      data: {
        status: "FAILED",
        error: "invalid_promotion_price_rule",
      },
    });
  });

  it("rejects a promotion policy with an unsafe scope", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "policy-bad-scope",
      tenantId: "tenant-1",
      storeId: "store-1",
      type: "PROMOTION_POLICY",
      status: "APPROVED",
      payloadJson: {
        sop: "只报 Polo 商品",
        rule: { all: [{ field: "stock", operator: "gte", value: 5 }] },
        priceRule: { mode: "multiplier", value: 0.9 },
        scope: { offerIdPrefixes: ["POLO"], script: "alert(1)" },
      },
      guardrailJson: {},
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "policy-bad-scope",
      type: "PROMOTION_POLICY",
      status: "FAILED",
    });

    await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "policy-bad-scope",
    });

    expect(prisma.agentAction.update).toHaveBeenCalledWith({
      where: { id: "policy-bad-scope" },
      data: {
        status: "FAILED",
        error: "invalid_promotion_scope",
      },
    });
  });

  it("records partial Ozon promotion activation results", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "enroll-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      type: "PROMOTION_ENROLLMENT",
      status: "APPROVED",
      payloadJson: {
        actionId: 7,
        policyActionId: "policy-1",
        productIds: [10, 11],
      },
      guardrailJson: {},
    });
    activatePromotionEnrollment.mockResolvedValue({
      product_ids: [10],
      rejected: [{ product_id: 11, reason: "price_changed" }],
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "enroll-1",
      type: "PROMOTION_ENROLLMENT",
      status: "EXECUTED",
    });

    await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "enroll-1",
    });

    expect(activatePromotionEnrollment).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      storeId: "store-1",
      actionId: 7,
      policyActionId: "policy-1",
      productIds: [10, 11],
    });
    expect(prisma.agentAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guardrailJson: expect.objectContaining({
            execution: expect.objectContaining({
              result: "partial",
              activatedProductIds: [10],
              rejected: [{ product_id: 11, reason: "price_changed" }],
            }),
          }),
        }),
      }),
    );
  });

  it("does not submit a promotion twice when another request claimed it", async () => {
    const action = {
      id: "enroll-2",
      tenantId: "tenant-1",
      storeId: "store-1",
      type: "PROMOTION_ENROLLMENT",
      status: "APPROVED",
      payloadJson: {
        actionId: 7,
        policyActionId: "policy-1",
        productIds: [10],
      },
      guardrailJson: {},
    };
    prisma.agentAction.findFirst.mockResolvedValue(action);
    prisma.agentAction.updateMany.mockResolvedValue({ count: 0 });

    await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "enroll-2",
    });

    expect(activatePromotionEnrollment).not.toHaveBeenCalled();
  });

  it("marks an enrollment failed when Ozon rejects every product", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "enroll-3",
      tenantId: "tenant-1",
      storeId: "store-1",
      type: "PROMOTION_ENROLLMENT",
      status: "APPROVED",
      payloadJson: {
        actionId: 7,
        policyActionId: "policy-1",
        productIds: [10],
      },
      guardrailJson: {},
    });
    activatePromotionEnrollment.mockResolvedValue({
      product_ids: [],
      rejected: [{ product_id: 10, reason: "not_eligible" }],
    });
    prisma.agentAction.update.mockResolvedValue({
      id: "enroll-3",
      status: "FAILED",
    });

    await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "enroll-3",
    });

    expect(prisma.agentAction.update).toHaveBeenCalledWith({
      where: { id: "enroll-3" },
      data: {
        status: "FAILED",
        error: expect.stringContaining("promotion_all_products_rejected"),
      },
    });
  });
});
