import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  agentAction: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

const activatePromotionEnrollment = vi.hoisted(() => vi.fn());

vi.mock("@saas/db", () => ({
  prisma,
  AgentActionStatus: {
    APPROVED: "APPROVED",
    EXECUTED: "EXECUTED",
    FAILED: "FAILED",
    PENDING_APPROVAL: "PENDING_APPROVAL",
    RECOMMENDED: "RECOMMENDED",
    BLOCKED: "BLOCKED",
  },
  AgentRiskLevel: {
    MEDIUM: "MEDIUM",
  },
}));

vi.mock("./promotions", () => ({ activatePromotionEnrollment }));

import { executeApprovedAgentAction, validateCompetitorBatchPayload } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  prisma.agentAction.updateMany.mockResolvedValue({ count: 1 });
  process.env.ENABLE_REAL_OZON_SUBMIT = "false";
});

describe("executeApprovedAgentAction", () => {
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
