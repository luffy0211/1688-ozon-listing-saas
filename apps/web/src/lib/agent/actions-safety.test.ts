import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    agentAction: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    store: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    sourceProduct: { findFirst: vi.fn(), update: vi.fn() },
    pricingRule: { findFirst: vi.fn() },
    ozonDraft: { findFirst: vi.fn(), update: vi.fn() },
    publishRun: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    xiangjiCredential: { count: vi.fn() },
  },
  client: {
    getProductInfoList: vi.fn(), getProductInfoAttributes: vi.fn(),
    getProductImportInfo: vi.fn(), getProductStocks: vi.fn(),
    importProducts: vi.fn(), importPrices: vi.fn(), updateStocks: vi.fn(),
    importPictures: vi.fn(), updateAttributes: vi.fn(), deleteProducts: vi.fn(),
    archiveProducts: vi.fn(), unarchiveProducts: vi.fn(),
  },
  consume: vi.fn(), refund: vi.fn(), activate: vi.fn(),
}));

vi.mock("@saas/db", () => ({
  prisma: mocks.prisma, decryptSecret: (value: string) => value,
  AgentActionStatus: Object.fromEntries(["APPROVED", "BLOCKED", "EXECUTED", "FAILED"].map((s) => [s, s])),
  AgentRiskLevel: { LOW: "LOW", MEDIUM: "MEDIUM" },
}));
vi.mock("@saas/ozon", () => ({
  OzonClient: vi.fn(function () { return mocks.client; }),
  computeRequestHash: () => "hash", checkSubmitGuards: () => ({ ok: true }),
}));
vi.mock("../env", () => ({ env: { ozonApiBase: "https://unused.invalid" } }));
vi.mock("../credits", () => ({ consumeTenantCredits: mocks.consume, refundTenantCredits: mocks.refund }));
vi.mock("./promotions", () => ({ activatePromotionEnrollment: mocks.activate }));

import { executeApprovedAgentAction, recoverBlockedAgentAction } from "./actions";

const args = { tenantId: "tenant-1", userId: "user-1", actionId: "action-1" };
const product = {
  id: 42, offer_id: "SKU-1", name: "Old title", description: "Old description",
  description_category_id: 1, type_id: 2, price: "300", old_price: "400",
  currency_code: "RUB", images: ["https://example.com/image.jpg"],
  attributes: [{ id: 4191, values: [{ value: "Old description" }] }],
  weight: 100, width: 100, height: 100, depth: 100,
};
const content = {
  suggestions: [
    { field: "title", current: "Old title", suggestedRu: "Approved title" },
    { field: "description", current: "Old description", suggestedRu: "Approved description" },
  ],
  product: { storeId: "store-1", offerId: "SKU-1", productId: "42", rawInfo: product },
};

function action(type: string, payloadJson: unknown = {}, overrides = {}) {
  return {
    id: args.actionId, tenantId: args.tenantId, storeId: "store-1", offerId: "SKU-1", productId: "42",
    type, status: "APPROVED", error: null, payloadJson, guardrailJson: {},
    updatedAt: new Date("2026-09-28T00:00:00Z"), ...overrides,
  };
}
function useAction(value: ReturnType<typeof action>) {
  mocks.prisma.agentAction.findFirst.mockResolvedValue(value);
  mocks.prisma.agentAction.update.mockImplementation(async ({ data }) => ({ ...value, ...data }));
  return value;
}
function execution(result: unknown) {
  return (result as { guardrailJson: { execution: Record<string, any> } }).guardrailJson.execution;
}
function expectNoWrites() {
  for (const name of ["importProducts", "importPrices", "updateStocks", "importPictures", "updateAttributes",
    "deleteProducts", "archiveProducts", "unarchiveProducts"] as const) {
    expect(mocks.client[name], name).not.toHaveBeenCalled();
  }
  expect(mocks.activate).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENABLE_REAL_OZON_SUBMIT", "true");
  mocks.consume.mockResolvedValue({});
  mocks.refund.mockResolvedValue({});
  mocks.activate.mockResolvedValue({ product_ids: [99], rejected: [] });
  mocks.prisma.agentAction.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.store.findFirst.mockResolvedValue({ id: "store-1", ozonClientId: "test", ozonApiKey: "test" });
  mocks.client.getProductInfoList.mockResolvedValue([product]);
  mocks.client.getProductInfoAttributes.mockResolvedValue([product]);
  mocks.client.getProductImportInfo.mockResolvedValue({ items: [{ offer_id: "SKU-1", status: "imported", errors: [] }] });
  mocks.prisma.sourceProduct.findFirst.mockResolvedValue({ productFacts: [{ normalizedJson: { purchaseCny: 10 } }] });
  mocks.prisma.pricingRule.findFirst.mockResolvedValue({ cnyToRub: 10, commissionRate: 0.15 });
  mocks.client.importProducts.mockImplementation(async () => {
    mocks.client.getProductInfoAttributes.mockResolvedValue([{ ...product, name: "Approved title", description: "Approved description" }]);
    return { task_id: 123 };
  });
  for (const name of ["importPrices", "updateStocks", "importPictures", "updateAttributes",
    "deleteProducts", "archiveProducts", "unarchiveProducts"] as const) {
    mocks.client[name].mockResolvedValue({ raw: { result: [{ offer_id: "SKU-1", product_id: 42, updated: true }] } });
  }
  mocks.client.getProductStocks.mockResolvedValue([{ product_id: 42, offer_id: "SKU-1", stocks: [{ warehouse_id: 5, present: 2 }] }]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("mutation identity boundaries", () => {
  const cases = [
    ["UPDATE_PRICE", { proposedPriceRub: 300 }],
    ["UPDATE_STOCK", { stock: 2, warehouseId: 5 }],
    ["UPDATE_IMAGES", { images: product.images }],
    ["UPDATE_ATTRIBUTES", { attributes: product.attributes }],
    ["UPDATE_CATEGORY", { importPayload: { items: [product] } }],
    ["CONTENT_DRAFT", content], ["ARCHIVE_PRODUCT", {}], ["UNARCHIVE_PRODUCT", {}], ["DELETE_PRODUCT", {}],
  ] as const;
  it.each(cases)("executes %s when both live identities match", async (type, payload) => {
    useAction(action(type, payload));
    const result = await executeApprovedAgentAction(args);
    expect(result?.status).toBe("EXECUTED");
  });
  it.each(cases)("rejects %s when live product id disagrees with the approved offer", async (type, payload) => {
    useAction(action(type, payload));
    mocks.client.getProductInfoList.mockResolvedValue([{ ...product, id: 99 }]);
    const result = await executeApprovedAgentAction(args);
    expectNoWrites();
    expect(result).toMatchObject({ status: "FAILED", error: expect.stringContaining("identity_mismatch") });
  });
  it.each(cases)("rejects %s when live offer disagrees with the approved product", async (type, payload) => {
    useAction(action(type, payload));
    mocks.client.getProductInfoList.mockResolvedValue([{ ...product, offer_id: "OTHER" }]);
    const result = await executeApprovedAgentAction(args);
    expectNoWrites();
    expect(result?.status).toBe("FAILED");
  });
  it.each([0, -1, 1.5, "oops", "9007199254740993"])("rejects invalid product ID %s before writing", async (id) => {
    useAction(action("UPDATE_STOCK", { stock: 2, warehouseId: 5 }, { productId: String(id) }));
    await executeApprovedAgentAction(args);
    expectNoWrites();
  });
  it.each([
    { offerId: "OTHER" }, { productId: 99 }, { storeId: "other-store" },
    { product: { ...content.product, offerId: "OTHER" } },
    { product: { ...content.product, rawInfo: { ...product, id: 99 } } },
  ])("rejects conflicting payload identity %j", async (identity) => {
    useAction(action("CONTENT_DRAFT", { ...content, ...identity }));
    await executeApprovedAgentAction(args);
    expectNoWrites();
  });
  it("uses the tenant-scoped store and rejects missing store membership", async () => {
    useAction(action("ARCHIVE_PRODUCT"));
    mocks.prisma.store.findFirst.mockResolvedValue(null);
    await executeApprovedAgentAction(args);
    expect(mocks.prisma.store.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "store-1", tenantId: "tenant-1" } }));
    expectNoWrites();
  });
  it("does not use unrelated attribute data to construct a content write", async () => {
    useAction(action("CONTENT_DRAFT", content));
    mocks.client.getProductInfoAttributes.mockResolvedValue([{ ...product, offer_id: "OTHER" }]);
    await executeApprovedAgentAction(args);
    expectNoWrites();
  });
  it.each([[{ ...product, offer_id: "OTHER" }], [product, { ...product, offer_id: "OTHER" }]])(
    "rejects category import items outside the approved single-product scope", async (...items) => {
      useAction(action("UPDATE_CATEGORY", { importPayload: { items: items.flat() } }));
      await executeApprovedAgentAction(args);
      expectNoWrites();
    },
  );
  it("cross-checks promotion selection against any approved single-product identity", async () => {
    useAction(action("PROMOTION_ENROLLMENT", { actionId: 7, policyActionId: "policy", productIds: [99] }));
    await executeApprovedAgentAction(args);
    expectNoWrites();
  });
  it("rejects a promotion list containing an invalid ID instead of silently filtering it", async () => {
    useAction(action("PROMOTION_ENROLLMENT", { actionId: 7, policyActionId: "policy", productIds: [42, "invalid"] }, { productId: null, offerId: null }));
    await executeApprovedAgentAction(args);
    expectNoWrites();
  });
});

describe("bulk write evidence", () => {
  const item = { type: "UPDATE_PRICE", offerId: "SKU-1", productId: 42, proposedPriceRub: 300 };
  it.each(["importPrices", "updateStocks", "importPictures", "updateAttributes", "deleteProducts"] as const)(
    "keeps an attempted %s timeout pending with its approved payload", async (method) => {
      const payloads = {
        importPrices: item,
        updateStocks: { ...item, type: "UPDATE_STOCK", stock: 2, warehouseId: 5 },
        importPictures: { ...item, type: "UPDATE_IMAGES", images: product.images },
        updateAttributes: { ...item, type: "UPDATE_ATTRIBUTES", attributes: product.attributes },
        deleteProducts: { ...item, type: "DELETE_PRODUCT" },
      };
      useAction(action("BULK_PRODUCT_UPDATE", { items: [payloads[method]] }, { offerId: null, productId: null }));
      mocks.client[method].mockRejectedValue(new Error("socket hang up"));
      const result = await executeApprovedAgentAction(args);
      expect(result).toMatchObject({ status: "BLOCKED", error: "result_pending_verification" });
      expect(execution(result)).toMatchObject({ pending: 1, failed: 0, results: [{ status: "pending_verification", payload: payloads[method], writeAttempted: true }] });
      expect(mocks.refund).not.toHaveBeenCalled();
    },
  );
  it("does not call an invalid bulk item's write", async () => {
    useAction(action("BULK_PRODUCT_UPDATE", { items: [{ ...item, productId: 99 }] }));
    await executeApprovedAgentAction(args);
    expectNoWrites();
  });
  it("checks an inherited approved product ID even when the bulk item only names its offer", async () => {
    useAction(action("BULK_PRODUCT_UPDATE", { items: [{ type: "UPDATE_PRICE", offerId: "SKU-1", proposedPriceRub: 300 }] }));
    mocks.client.getProductInfoList.mockResolvedValue([{ ...product, id: 99 }]);
    await executeApprovedAgentAction(args);
    expectNoWrites();
  });
  it("retains a successful write response when the subsequent readback times out", async () => {
    useAction(action("BULK_PRODUCT_UPDATE", { items: [item] }));
    mocks.client.getProductInfoList.mockResolvedValueOnce([product]).mockRejectedValueOnce(new Error("fetch failed"));
    const result = await executeApprovedAgentAction(args);
    expect(execution(result)).toMatchObject({ pending: 1, results: [{ status: "pending_verification", payload: item,
      response: { result: [{ offer_id: "SKU-1", product_id: 42, updated: true }] },
    }] });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("does not confuse a preflight network failure with an attempted write", async () => {
    useAction(action("BULK_PRODUCT_UPDATE", { items: [item] }));
    mocks.client.getProductInfoList.mockRejectedValue(new Error("network timeout"));
    const result = await executeApprovedAgentAction(args);
    expect(result?.status).toBe("FAILED");
    expectNoWrites();
    expect(mocks.refund).toHaveBeenCalledOnce();
  });
  it("persists completed items before attempting the next write, then recovers only pending items", async () => {
    const second = { ...item, offerId: "SKU-2", productId: 43 };
    useAction(action("BULK_PRODUCT_UPDATE", { items: [item, second] }, { offerId: null, productId: null }));
    mocks.client.getProductInfoList.mockImplementation(async ({ offerIds }) => [{ ...product, offer_id: offerIds[0], id: offerIds[0] === "SKU-1" ? 42 : 43 }]);
    mocks.client.importPrices.mockResolvedValueOnce({ raw: { result: [{ offer_id: "SKU-1", updated: true }] } })
      .mockImplementationOnce(async () => {
        const updates = mocks.prisma.agentAction.update.mock.calls.map(([call]) => call.data.guardrailJson?.execution);
        expect(updates.some((e) => e?.results?.[0]?.status === "executed")).toBe(true);
        throw new Error("timeout");
      });
    const pending = await executeApprovedAgentAction(args);
    expect(execution(pending)).toMatchObject({ executed: 1, pending: 1, failed: 0 });
    useAction(pending as ReturnType<typeof action>);
    mocks.client.getProductInfoList.mockClear();
    const recovered = await recoverBlockedAgentAction({ ...args, now: new Date("2026-09-28T00:03:00Z") });
    expect(recovered?.status).toBe("EXECUTED");
    expect(execution(recovered)).toMatchObject({ executed: 2, pending: 0, results: [{ status: "executed" }, { status: "executed" }] });
    expect(mocks.client.getProductInfoList.mock.calls.every(([query]) => query.offerIds[0] === "SKU-2")).toBe(true);
    expect(mocks.client.importPrices).toHaveBeenCalledTimes(2);
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("keeps executed and failed items when the pending item recovers to final partial execution", async () => {
    const items = [item, { ...item, offerId: "SKU-2", productId: 43 }, { ...item, offerId: "SKU-3", productId: 44 }];
    useAction(action("BULK_PRODUCT_UPDATE", { items }, { offerId: null, productId: null }));
    mocks.client.getProductInfoList.mockImplementation(async ({ offerIds }) => [{
      ...product, offer_id: offerIds[0], id: items.find((target) => target.offerId === offerIds[0])!.productId,
    }]);
    mocks.client.importPrices
      .mockResolvedValueOnce({ raw: { result: [{ offer_id: "SKU-1", updated: true }] } })
      .mockResolvedValueOnce({ raw: { result: [{ offer_id: "SKU-2", updated: false, errors: [{ code: "BAD_PRICE" }] }] } })
      .mockRejectedValueOnce(new Error("timeout"));
    const pending = await executeApprovedAgentAction(args);
    expect(pending?.error).toBe("result_pending_verification");
    expect(execution(pending)).toMatchObject({ executed: 1, failed: 1, pending: 1 });
    const originalResults = execution(pending).results;
    useAction(pending as ReturnType<typeof action>);
    mocks.client.getProductInfoList.mockClear();
    const result = await recoverBlockedAgentAction(args);
    expect(result).toMatchObject({ status: "BLOCKED", error: "partial_execution" });
    expect(execution(result)).toMatchObject({ executed: 2, failed: 1, pending: 0, results: [
      originalResults[0], originalResults[1], expect.objectContaining({ status: "executed", payload: items[2] }),
    ] });
    expect(mocks.client.getProductInfoList).toHaveBeenCalledExactlyOnceWith({ offerIds: ["SKU-3"] });
    expect(mocks.client.importPrices).toHaveBeenCalledTimes(3);
    expect(mocks.consume).toHaveBeenCalledOnce();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});

describe("bounded approved content recovery", () => {
  function pending(overrides = {}) {
    return useAction(action("CONTENT_DRAFT", content, {
      status: "BLOCKED", error: "result_pending_verification",
      guardrailJson: { execution: { ozonTaskId: "123", changedFields: ["title", "description"], ...overrides } },
    }));
  }
  beforeEach(() => {
    mocks.client.getProductInfoAttributes.mockResolvedValue([{ ...product, name: "Approved title" }]);
  });
  it("polls the known task then writes only the missing approved description once", async () => {
    pending();
    mocks.client.updateAttributes.mockImplementation(async () => {
      expect(mocks.client.getProductImportInfo).toHaveBeenCalledWith("123");
      const claims = mocks.prisma.agentAction.updateMany.mock.calls.map(([call]) => call.data.guardrailJson?.execution);
      expect(claims.some((e) => e?.writeRetryCount === 1)).toBe(true);
      mocks.client.getProductInfoAttributes.mockResolvedValue([{ ...product, name: "Approved title", description: "Approved description" }]);
      return { raw: { result: [{ offer_id: "SKU-1", product_id: 42, updated: true }] } };
    });
    const result = await recoverBlockedAgentAction(args);
    expect(mocks.client.updateAttributes).toHaveBeenCalledExactlyOnceWith({ items: [{
      offer_id: "SKU-1", product_id: 42,
      attributes: [{ id: 4191, values: [{ value: "Approved description" }] }],
    }] });
    expect(result?.status).toBe("EXECUTED");
    expect(execution(result)).toMatchObject({ writeRetryCount: 1, appliedFields: ["title", "description"] });
    expect(mocks.client.importProducts).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it.each(["pending", "processing", "unknown", "failed"])("never retries a task in state %s", async (status) => {
    pending();
    mocks.client.getProductImportInfo.mockResolvedValue({ items: [{ offer_id: "SKU-1", status, errors: [] }] });
    const result = await recoverBlockedAgentAction(args);
    expectNoWrites();
    expect(result?.status).toBe("BLOCKED");
    expect(execution(result).manualMessage).toEqual(expect.any(String));
  });
  it.each([
    { ozonTaskId: null }, { writeRetryCount: 1 },
  ])("does not blindly retry ambiguous or previously retried writes: %j", async (state) => {
    pending(state);
    const result = await recoverBlockedAgentAction(args);
    expectNoWrites();
    expect(result?.status).toBe("BLOCKED");
    expect(execution(result).manualMessage).toEqual(expect.any(String));
  });
  it("does not replace a description changed by someone else", async () => {
    pending();
    mocks.client.getProductInfoAttributes.mockResolvedValue([{ ...product, name: "Approved title", description: "Someone else's description" }]);
    const result = await recoverBlockedAgentAction(args);
    expectNoWrites();
    expect(result?.status).toBe("BLOCKED");
  });
  it("does not retry when the real-submit gate is disabled", async () => {
    pending();
    vi.stubEnv("ENABLE_REAL_OZON_SUBMIT", "false");
    const result = await recoverBlockedAgentAction(args);
    expectNoWrites();
    expect(result?.status).toBe("BLOCKED");
  });
  it("keeps a retry timeout pending and never retries it a second time", async () => {
    pending();
    mocks.client.updateAttributes.mockRejectedValue(new Error("network timeout"));
    const first = await recoverBlockedAgentAction(args);
    expect(execution(first).writeRetryCount).toBe(1);
    useAction(first as ReturnType<typeof action>);
    const second = await recoverBlockedAgentAction(args);
    expect(second?.status).toBe("BLOCKED");
    expect(mocks.client.updateAttributes).toHaveBeenCalledOnce();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("honors another recovery lease before any remote activity", async () => {
    pending({ recoveryLeaseExpiresAt: new Date(Date.now() + 120_000).toISOString() });
    await recoverBlockedAgentAction(args);
    expect(mocks.client.getProductImportInfo).not.toHaveBeenCalled();
    expect(mocks.client.getProductInfoAttributes).not.toHaveBeenCalled();
    expect(mocks.prisma.agentAction.updateMany).not.toHaveBeenCalled();
  });
  it("conditions every recovery finalization on the same lease", async () => {
    pending({ writeRetryCount: 1 });
    await recoverBlockedAgentAction(args);
    const lease = mocks.prisma.agentAction.updateMany.mock.calls[0]![0].data.guardrailJson.execution.recoveryLeaseId;
    expect(mocks.prisma.agentAction.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "BLOCKED", guardrailJson: {
        path: ["execution", "recoveryLeaseId"], equals: lease,
      } }),
    }));
  });
  it("does not write when the field-repair lease claim returns count zero", async () => {
    pending();
    mocks.prisma.agentAction.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const result = await recoverBlockedAgentAction(args);
    expect(mocks.prisma.agentAction.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.agentAction.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ guardrailJson: expect.objectContaining({ execution: expect.objectContaining({ writeRetryCount: 1 }) }) }),
    }));
    expect(result?.status).toBe("BLOCKED");
    expectNoWrites();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("does not retry a task result belonging to a different product", async () => {
    pending();
    mocks.client.getProductImportInfo.mockResolvedValue({ items: [{ offer_id: "SKU-1", product_id: 99, status: "imported", errors: [] }] });
    await recoverBlockedAgentAction(args);
    expectNoWrites();
  });
});

describe("publish preclaim", () => {
  beforeEach(() => {
    useAction(action("PUBLISH_DRAFT", { draftId: "draft-1" }, { productId: "source-1" }));
    mocks.prisma.ozonDraft.findFirst.mockResolvedValue({
      id: "draft-1", tenantId: "tenant-1", storeId: "store-1", productId: "source-1", status: "COMPILED",
      store: { id: "store-1", ozonClientId: "test", ozonApiKey: "test" },
      product: { id: "source-1", offerId: "SKU-1", productAssets: [] },
      payloadJson: { items: [product] },
    });
    mocks.prisma.publishRun.findUnique.mockResolvedValue(null);
    mocks.prisma.publishRun.create.mockResolvedValue({ id: "run-1" });
    mocks.prisma.publishRun.update.mockResolvedValue({ id: "run-1" });
    mocks.prisma.xiangjiCredential.count.mockResolvedValue(1);
  });
  it("claims the unique request hash before charging once and performing the external write", async () => {
    mocks.client.importProducts.mockImplementation(async () => {
      expect(mocks.prisma.publishRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        tenantId: "tenant-1", storeId: "store-1", draftId: "draft-1", requestHash: "hash", status: "submitting",
      }) });
      return { task_id: 123 };
    });
    await executeApprovedAgentAction(args);
    expect(mocks.consume).toHaveBeenCalledOnce();
    expect(mocks.prisma.publishRun.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.consume.mock.invocationCallOrder[0]!);
    expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(mocks.client.importProducts.mock.invocationCallOrder[0]!);
    expect(mocks.prisma.publishRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "submitted", ozonTaskId: "123" }) }));
  });
  it("does not write when the atomic claim loses the uniqueness race", async () => {
    mocks.prisma.publishRun.create.mockRejectedValue({ code: "P2002" });
    await executeApprovedAgentAction(args);
    expectNoWrites();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("does not debit for an already claimed publish request", async () => {
    mocks.prisma.publishRun.findUnique.mockResolvedValue({ id: "existing-run" });
    const result = await executeApprovedAgentAction(args);
    expect(result?.error).toBe("duplicate_submission");
    expectNoWrites();
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it.each(["publishRun", "ozonDraft", "sourceProduct", "agentAction"] as const)(
    "keeps a submitted publish pending without refund when the %s update fails", async (model) => {
      mocks.prisma[model].update.mockRejectedValueOnce(new Error("local persistence failed"));
      const result = await executeApprovedAgentAction(args);
      expect(result).toMatchObject({ status: "BLOCKED", error: "result_pending_verification" });
      expect(execution(result)).toMatchObject({
        publishRunId: "run-1", requestHash: "hash", request: { items: [product] },
        ozonTaskId: "123", response: { task_id: 123 }, error: "local persistence failed",
      });
      expect(mocks.client.importProducts).toHaveBeenCalledOnce();
      expect(mocks.consume).toHaveBeenCalledOnce();
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.prisma.agentAction.update.mock.calls.some(([call]) => call.data.status === "FAILED")).toBe(false);
    },
  );
  it("keeps a submitted publish pending when the execution audit fails", async () => {
    mocks.prisma.auditLog.create.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("audit persistence failed"));
    const result = await executeApprovedAgentAction(args);
    expect(result).toMatchObject({ status: "BLOCKED", error: "result_pending_verification" });
    expect(execution(result)).toMatchObject({ publishRunId: "run-1", ozonTaskId: "123", response: { task_id: 123 } });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("retains the claim and evidence when submission times out", async () => {
    mocks.client.importProducts.mockRejectedValue(new Error("timeout"));
    const result = await executeApprovedAgentAction(args);
    expect(result).toMatchObject({ status: "BLOCKED", error: "result_pending_verification" });
    expect(execution(result)).toMatchObject({ publishRunId: "run-1", requestHash: "hash", request: { items: [product] } });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("rejects a draft belonging to a different approved store", async () => {
    useAction(action("PUBLISH_DRAFT", { draftId: "draft-1" }, { storeId: "other-store", productId: "source-1" }));
    await executeApprovedAgentAction(args);
    expectNoWrites();
    expect(mocks.prisma.publishRun.create).not.toHaveBeenCalled();
  });
});
