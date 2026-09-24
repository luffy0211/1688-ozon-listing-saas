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
  sourceProduct: {
    findFirst: vi.fn(),
  },
  pricingRule: {
    findFirst: vi.fn(),
  },
}));

const activatePromotionEnrollment = vi.hoisted(() => vi.fn());
const consumeTenantCredits = vi.hoisted(() => vi.fn());
const refundTenantCredits = vi.hoisted(() => vi.fn());
const ozonClientMock = vi.hoisted(() => ({
  getProductInfoList: vi.fn(),
  getProductInfoAttributes: vi.fn(),
  getProductImportInfo: vi.fn(),
  getProductStocks: vi.fn(),
  importProducts: vi.fn(),
  importPrices: vi.fn(),
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
vi.mock("../credits", () => ({ consumeTenantCredits, refundTenantCredits }));
vi.mock("@saas/ozon", () => ({
  OzonClient: vi.fn(function OzonClient() {
    return ozonClientMock;
  }),
  computeRequestHash: vi.fn(() => "request-hash"),
  checkSubmitGuards: vi.fn(() => undefined),
}));

import {
  approveAgentAction,
  confirmContentDraftAction,
  contentDraftImportPayload,
  executeApprovedAgentAction,
  recoverBlockedAgentAction,
  rejectAgentAction,
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
  ozonClientMock.getProductInfoAttributes.mockResolvedValue([{
    offer_id: "SKU-1",
    name: "Новое название",
    description: "Описание из аннотации",
  }]);
  ozonClientMock.importProducts.mockResolvedValue({ task_id: 123 });
  ozonClientMock.importPrices.mockResolvedValue({
    task_id: 123,
    raw: { result: { task_id: 123 } },
  });
  prisma.sourceProduct.findFirst.mockResolvedValue({
    productFacts: [{ normalizedJson: { purchaseCny: { value: 10 } } }],
  });
  prisma.pricingRule.findFirst.mockResolvedValue({
    cnyToRub: 10,
    commissionRate: 0.15,
  });
  ozonClientMock.getProductImportInfo.mockResolvedValue({
    items: [{ offer_id: "SKU-1", status: "imported", errors: [] }],
    total: 1,
    raw: {},
  });
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
            currency_code: "CNY",
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
    expect(request.items[0]?.currency_code).toBe("CNY");
  });

  it("writes confirmed description drafts into the Ozon annotation attribute", () => {
    const { request, changedFields } = contentDraftImportPayload({
      offerId: "SKU-1",
      payloadJson: {
        suggestions: [
          { field: "description", suggestedRu: "Новое описание товара" },
        ],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Название",
            description_category_id: 200000933,
            type_id: 93194,
            price: "129.00",
            old_price: "269.00",
            currency_code: "CNY",
            vat: "0",
            images: ["https://example.com/1.jpg"],
            attributes: [
              { id: 4191, values: [{ value: "Старое описание" }] },
            ],
            weight: 300,
            width: 200,
            height: 10,
            depth: 300,
          },
        },
      },
    });

    const annotation = request.items[0]?.attributes.find((attribute) => attribute.id === 4191);
    expect(changedFields).toEqual(["description"]);
    expect(request.items[0]?.description).toBe("Новое описание товара");
    expect(annotation?.values).toEqual([{ value: "Новое описание товара" }]);
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
            currency_code: "CNY",
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
    expect(ozonClientMock.getProductImportInfo).toHaveBeenCalledWith(123);
    expect(ozonClientMock.getProductInfoAttributes).toHaveBeenCalledWith({ offerIds: ["SKU-1"] });
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

  it("treats Ozon annotation attribute 4191 as an applied description draft", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "content-description",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: "5853386614",
      type: "CONTENT_DRAFT",
      status: "APPROVED",
      guardrailJson: {},
      payloadJson: {
        suggestions: [{
          field: "description",
          suggestedRu: "Новое описание товара",
        }],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Название",
            description_category_id: 200000933,
            type_id: 93194,
            price: "129.00",
            old_price: "269.00",
            currency_code: "CNY",
            vat: "0",
            images: ["https://example.com/1.jpg"],
            attributes: [{ id: 4191, values: [{ value: "Старое описание" }] }],
            weight: 300,
            width: 200,
            height: 10,
            depth: 300,
          },
        },
      },
    });
    ozonClientMock.getProductInfoAttributes.mockResolvedValue([{
      offer_id: "SKU-1",
      name: "Название",
      description: null,
      attributes: [{ id: 4191, values: [{ value: "Новое описание товара" }] }],
    }]);
    prisma.agentAction.update.mockResolvedValue({
      id: "content-description",
      type: "CONTENT_DRAFT",
      status: "EXECUTED",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "content-description",
    });

    expect(result?.status).toBe("EXECUTED");
    expect(ozonClientMock.importProducts).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({
        description: "Новое описание товара",
        attributes: expect.arrayContaining([
          { id: 4191, values: [{ value: "Новое описание товара" }] },
        ]),
      })],
    }));
    expect(refundTenantCredits).not.toHaveBeenCalled();
  });

  it("fails and refunds content drafts when Ozon import task rejects the item", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "content-task-failed",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: "5853386614",
      type: "CONTENT_DRAFT",
      status: "APPROVED",
      guardrailJson: {},
      payloadJson: {
        suggestions: [{ field: "title", suggestedRu: "Новое название" }],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Старое название",
            description_category_id: 200000933,
            type_id: 93194,
            price: "129.00",
            old_price: "269.00",
            currency_code: "CNY",
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
    ozonClientMock.getProductImportInfo.mockResolvedValue({
      items: [{
        offer_id: "SKU-1",
        status: "failed",
        errors: [{
          code: "currency_differs_from_contract",
          field: "currency",
          level: "error",
          message: "Неверно указана валюта",
        }],
      }],
      total: 1,
      raw: {},
    });
    ozonClientMock.getProductInfoAttributes.mockResolvedValue([{
      offer_id: "SKU-1",
      name: "Старое название",
      description: "Описание",
      attributes: [{ id: 4191, values: [{ value: "Описание" }] }],
    }]);
    prisma.agentAction.update.mockResolvedValue({
      id: "content-task-failed",
      type: "CONTENT_DRAFT",
      status: "FAILED",
      error: "ozon_import_task_failed:currency_differs_from_contract:Неверно указана валюта",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "content-task-failed",
    });

    expect(result?.status).toBe("FAILED");
    expect(prisma.agentAction.update).toHaveBeenCalledWith({
      where: { id: "content-task-failed", tenantId: "tenant-1" },
      data: {
        status: "FAILED",
        error: "ozon_import_task_failed:currency_differs_from_contract:Неверно указана валюта",
      },
    });
    expect(refundTenantCredits).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      feature: "ozon_action_execute",
      createdBy: "user-1",
      referenceType: "agent_action_execute",
      referenceId: "content-task-failed",
      idempotencyKey: "refund:agent-action-execute:content-task-failed",
    });
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
            currency_code: "CNY",
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
    ozonClientMock.getProductInfoAttributes.mockResolvedValue([{
      offer_id: "SKU-1",
      name: "Старое название",
      description: "Описание",
      attributes: [{ id: 4191, values: [{ value: "Описание" }] }],
    }]);
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

  it("marks timed-out content drafts executed when readback shows the approved field applied", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "content-timeout-applied",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: "5853386614",
      type: "CONTENT_DRAFT",
      status: "APPROVED",
      guardrailJson: {},
      payloadJson: {
        suggestions: [{ field: "title", suggestedRu: "Новое название" }],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Старое название",
            description_category_id: 200000933,
            type_id: 93194,
            price: "129.00",
            old_price: "269.00",
            currency_code: "CNY",
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
    ozonClientMock.importProducts.mockRejectedValue(new Error("timeout"));
    ozonClientMock.getProductInfoAttributes.mockResolvedValue([{
      offer_id: "SKU-1",
      name: "Новое название",
      description: "Описание",
      attributes: [{ id: 4191, values: [{ value: "Описание" }] }],
    }]);
    prisma.agentAction.update.mockResolvedValue({
      id: "content-timeout-applied",
      type: "CONTENT_DRAFT",
      status: "EXECUTED",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "content-timeout-applied",
    });

    expect(result?.status).toBe("EXECUTED");
    expect(prisma.agentAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "content-timeout-applied", tenantId: "tenant-1" },
        data: expect.objectContaining({
          status: "EXECUTED",
          guardrailJson: expect.objectContaining({
            execution: expect.objectContaining({
              recovery: "readback_after_error",
              changedFields: ["title"],
            }),
          }),
        }),
      }),
    );
    expect(refundTenantCredits).not.toHaveBeenCalled();
  });

  it("keeps partial content draft results pending without refunding successful fields", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "content-partial-applied",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: "5853386614",
      type: "CONTENT_DRAFT",
      status: "APPROVED",
      guardrailJson: {},
      payloadJson: {
        suggestions: [
          { field: "title", suggestedRu: "Новое название" },
          { field: "description", suggestedRu: "Новое описание товара" },
        ],
        product: {
          rawInfo: {
            offer_id: "SKU-1",
            name: "Старое название",
            description: "Старое описание",
            description_category_id: 200000933,
            type_id: 93194,
            price: "129.00",
            old_price: "269.00",
            currency_code: "CNY",
            vat: "0",
            images: ["https://example.com/1.jpg"],
            attributes: [{ id: 4191, values: [{ value: "Старое описание" }] }],
            weight: 300,
            width: 200,
            height: 10,
            depth: 300,
          },
        },
      },
    });
    ozonClientMock.importProducts.mockRejectedValue(new Error("timeout"));
    ozonClientMock.getProductInfoAttributes.mockResolvedValue([{
      offer_id: "SKU-1",
      name: "Новое название",
      description: "Старое описание",
      attributes: [{ id: 4191, values: [{ value: "Старое описание" }] }],
    }]);
    prisma.agentAction.update.mockResolvedValue({
      id: "content-partial-applied",
      type: "CONTENT_DRAFT",
      status: "BLOCKED",
      error: "result_pending_verification",
    });

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "content-partial-applied",
    });

    expect(result?.status).toBe("BLOCKED");
    expect(prisma.agentAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "content-partial-applied", tenantId: "tenant-1" },
        data: expect.objectContaining({
          status: "BLOCKED",
          error: "result_pending_verification",
          guardrailJson: expect.objectContaining({
            execution: expect.objectContaining({
              recovery: "readback_after_error",
              appliedFields: ["title"],
              missingFields: ["description"],
            }),
          }),
        }),
      }),
    );
    expect(refundTenantCredits).not.toHaveBeenCalled();
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
      where: { id: "action-1", tenantId: "tenant-1" },
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
      where: { id: "action-2", tenantId: "tenant-1" },
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
        where: { id: "policy-1", tenantId: "tenant-1" },
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
      where: { id: "policy-bad", tenantId: "tenant-1" },
      data: {
        status: "FAILED",
        error: "invalid_promotion_price_rule",
      },
    });
  });

  it("fails a price update when Ozon rejects it inside HTTP 200", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "price-rejected",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: null,
      type: "UPDATE_PRICE",
      status: "APPROVED",
      payloadJson: { proposedPriceRub: 300 },
      guardrailJson: {},
    });
    ozonClientMock.getProductInfoList
      .mockResolvedValueOnce([{ id: 1, offer_id: "SKU-1" }])
      .mockResolvedValueOnce([{ id: 1, offer_id: "SKU-1", price: "300" }]);
    ozonClientMock.importPrices.mockResolvedValue({
      raw: {
        result: [{
          offer_id: "SKU-1",
          updated: false,
          errors: [{ code: "BAD_PRICE" }],
        }],
      },
    });
    prisma.agentAction.update.mockImplementation(async ({ data }) => ({
      id: "price-rejected",
      type: "UPDATE_PRICE",
      ...data,
    }));

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "price-rejected",
    });

    expect(result?.status).toBe("FAILED");
    expect(prisma.agentAction.update).toHaveBeenLastCalledWith({
      where: { id: "price-rejected", tenantId: "tenant-1" },
      data: {
        status: "FAILED",
        error: expect.stringContaining("ozon_mutation_rejected"),
      },
    });
    expect(refundTenantCredits).toHaveBeenCalledTimes(1);
  });

  it("keeps a timed-out price write pending without refunding or retrying it", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "price-timeout",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: null,
      type: "UPDATE_PRICE",
      status: "APPROVED",
      payloadJson: { proposedPriceRub: 300 },
      guardrailJson: {},
      updatedAt: new Date("2026-09-24T12:00:00.000Z"),
    });
    ozonClientMock.getProductInfoList.mockResolvedValue([{ id: 1, offer_id: "SKU-1", price: "250" }]);
    ozonClientMock.importPrices.mockRejectedValue(new Error("socket hang up"));
    prisma.agentAction.update.mockImplementation(async ({ data }) => ({
      id: "price-timeout",
      type: "UPDATE_PRICE",
      ...data,
    }));

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "price-timeout",
    });

    expect(result?.status).toBe("BLOCKED");
    expect(result?.error).toBe("result_pending_verification");
    expect(refundTenantCredits).not.toHaveBeenCalled();
    expect(ozonClientMock.importPrices).toHaveBeenCalledTimes(1);
  });

  it("recovers a stale price action by readback without repeating the write", async () => {
    const action = {
      id: "price-recover",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: "SKU-1",
      productId: null,
      type: "UPDATE_PRICE",
      status: "BLOCKED",
      error: "execution_in_progress",
      payloadJson: { proposedPriceRub: 300 },
      guardrailJson: {},
      updatedAt: new Date("2026-09-24T12:00:00.000Z"),
    };
    prisma.agentAction.findFirst.mockResolvedValue(action);
    prisma.agentAction.updateMany.mockResolvedValue({ count: 1 });
    ozonClientMock.getProductInfoList.mockResolvedValue([{ offer_id: "SKU-1", price: "300" }]);
    prisma.agentAction.update.mockImplementation(async ({ data }) => ({ ...action, ...data }));

    const result = await recoverBlockedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: action.id,
      now: new Date("2026-09-24T12:03:00.000Z"),
    });

    expect(result?.status).toBe("EXECUTED");
    expect(ozonClientMock.importPrices).not.toHaveBeenCalled();
    expect(prisma.agentAction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "EXECUTED",
        guardrailJson: expect.objectContaining({
          execution: expect.objectContaining({
            phase: "finished",
            recovery: "readback",
          }),
        }),
      }),
    }));
  });

  it("keeps successful bulk price items and records rejected items as partial", async () => {
    process.env.ENABLE_REAL_OZON_SUBMIT = "true";
    prisma.agentAction.findFirst.mockResolvedValue({
      id: "bulk-price-partial",
      tenantId: "tenant-1",
      storeId: "store-1",
      offerId: null,
      productId: null,
      type: "BULK_PRODUCT_UPDATE",
      status: "APPROVED",
      payloadJson: {
        items: [
          { type: "UPDATE_PRICE", offerId: "SKU-A", proposedPriceRub: 300 },
          { type: "UPDATE_PRICE", offerId: "SKU-B", proposedPriceRub: 320 },
        ],
      },
      guardrailJson: {},
    });
    ozonClientMock.getProductInfoList
      .mockResolvedValueOnce([{ id: 1, offer_id: "SKU-A" }])
      .mockResolvedValueOnce([{ id: 1, offer_id: "SKU-A", price: "300" }])
      .mockResolvedValueOnce([{ id: 2, offer_id: "SKU-B" }]);
    ozonClientMock.importPrices
      .mockResolvedValueOnce({
        raw: { result: [{ offer_id: "SKU-A", updated: true, errors: [] }] },
      })
      .mockResolvedValueOnce({
        raw: {
          result: [{
            offer_id: "SKU-B",
            updated: false,
            errors: [{ code: "BAD_PRICE" }],
          }],
        },
      });
    prisma.agentAction.update.mockImplementation(async ({ data }) => ({
      id: "bulk-price-partial",
      type: "BULK_PRODUCT_UPDATE",
      ...data,
    }));

    const result = await executeApprovedAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: "bulk-price-partial",
    });

    expect(result?.status).toBe("BLOCKED");
    expect(prisma.agentAction.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "bulk-price-partial", tenantId: "tenant-1" },
      data: expect.objectContaining({
        status: "BLOCKED",
        error: "partial_execution",
        guardrailJson: expect.objectContaining({
          execution: expect.objectContaining({
            total: 2,
            executed: 1,
            failed: 1,
            results: [
              expect.objectContaining({ offerId: "SKU-A", status: "executed" }),
              expect.objectContaining({
                offerId: "SKU-B",
                status: "failed",
                error: expect.stringContaining("ozon_mutation_rejected"),
              }),
            ],
          }),
        }),
      }),
    }));
    expect(refundTenantCredits).not.toHaveBeenCalled();
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
      where: { id: "policy-bad-scope", tenantId: "tenant-1" },
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
      where: { id: "enroll-3", tenantId: "tenant-1" },
      data: {
        status: "FAILED",
        error: expect.stringContaining("promotion_all_products_rejected"),
      },
    });
  });
});

describe("agent action state transitions", () => {
  const pendingAction = {
    id: "action-concurrent",
    tenantId: "tenant-1",
    storeId: "store-1",
    type: "CONTENT_DRAFT",
    status: "PENDING_APPROVAL",
    updatedAt: new Date("2026-09-24T12:00:00.000Z"),
  };

  it("allows only one concurrent approval transition and audit", async () => {
    prisma.agentAction.findFirst
      .mockResolvedValueOnce(pendingAction)
      .mockResolvedValueOnce(pendingAction)
      .mockResolvedValue({ ...pendingAction, status: "APPROVED" });
    prisma.agentAction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.agentAction.update.mockResolvedValue({ ...pendingAction, status: "APPROVED" });

    await Promise.all([
      approveAgentAction({
        tenantId: "tenant-1",
        userId: "user-1",
        actionId: pendingAction.id,
        expectedVersion: pendingAction.updatedAt.toISOString(),
        expectedStoreId: pendingAction.storeId,
      }),
      approveAgentAction({
        tenantId: "tenant-1",
        userId: "user-1",
        actionId: pendingAction.id,
        expectedVersion: pendingAction.updatedAt.toISOString(),
        expectedStoreId: pendingAction.storeId,
      }),
    ]);

    expect(prisma.agentAction.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.agentAction.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("does not reject an action after execution has claimed it", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      ...pendingAction,
      status: "BLOCKED",
      error: "execution_in_progress",
    });

    const result = await rejectAgentAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: pendingAction.id,
      reason: "too late",
      expectedVersion: pendingAction.updatedAt.toISOString(),
      expectedStoreId: pendingAction.storeId,
    });

    expect(result?.status).toBe("BLOCKED");
    expect(prisma.agentAction.update).not.toHaveBeenCalled();
    expect(prisma.agentAction.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("stores content edits and approval in one version-checked transition", async () => {
    const action = {
      ...pendingAction,
      storeId: "store-1",
      payloadJson: {
        suggestions: [
          { field: "title", suggestedRu: "旧标题" },
          { field: "description", suggestedRu: "旧描述" },
        ],
      },
    };
    prisma.agentAction.findFirst
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce({ ...action, status: "APPROVED" });
    prisma.agentAction.updateMany.mockResolvedValue({ count: 1 });

    const result = await confirmContentDraftAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: action.id,
      expectedVersion: action.updatedAt.toISOString(),
      expectedStoreId: action.storeId,
      edits: [
        { field: "title", suggestedRu: "新标题" },
        { field: "description", suggestedRu: "新描述" },
      ],
    });

    expect(result?.status).toBe("APPROVED");
    expect(prisma.agentAction.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: action.id,
        tenantId: "tenant-1",
        status: "PENDING_APPROVAL",
        storeId: "store-1",
        updatedAt: action.updatedAt,
      }),
      data: expect.objectContaining({
        status: "APPROVED",
        payloadJson: expect.objectContaining({
          editedByUser: true,
          suggestions: [
            { field: "title", suggestedRu: "新标题" },
            { field: "description", suggestedRu: "新描述" },
          ],
        }),
      }),
    });
  });

  it("rejects stale or unauthorized content edits before changing state", async () => {
    prisma.agentAction.findFirst.mockResolvedValue({
      ...pendingAction,
      storeId: "store-1",
      payloadJson: { suggestions: [{ field: "title", suggestedRu: "旧标题" }] },
    });

    await expect(confirmContentDraftAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: pendingAction.id,
      expectedVersion: "2026-09-24T11:59:00.000Z",
      expectedStoreId: "store-1",
      edits: [{ field: "title", suggestedRu: "新标题" }],
    })).rejects.toMatchObject({ code: "agent_action_stale" });
    await expect(confirmContentDraftAction({
      tenantId: "tenant-1",
      userId: "user-1",
      actionId: pendingAction.id,
      expectedVersion: pendingAction.updatedAt.toISOString(),
      expectedStoreId: "store-1",
      edits: [{ field: "description", suggestedRu: "越权描述" }],
    })).rejects.toMatchObject({ code: "invalid_content_draft_edits" });
    expect(prisma.agentAction.updateMany).not.toHaveBeenCalled();
  });
});
