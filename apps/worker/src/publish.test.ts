import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), submit: vi.fn(), debit: vi.fn(), runUpdate: vi.fn(),
  draftUpdate: vi.fn(), productUpdate: vi.fn(), queueAdd: vi.fn(),
}));
vi.mock("bullmq", () => ({
  Queue: class { add = mocks.queueAdd; },
  Worker: class { on = vi.fn(); },
}));
vi.mock("./agent-recovery", () => ({ processAgentQueueJob: vi.fn() }));
vi.mock("../../web/src/lib/agent/publish-claim", () => ({ claimPublishRun: mocks.claim }));
vi.mock("@saas/db", async (original) => ({
  ...await original<typeof import("@saas/db")>(),
  prisma: {
    creditTransaction: { findUnique: mocks.debit },
    publishRun: { findUnique: vi.fn(), update: mocks.runUpdate, updateMany: mocks.runUpdate },
    ozonDraft: { update: mocks.draftUpdate, updateMany: mocks.draftUpdate },
    sourceProduct: { update: mocks.productUpdate, updateMany: mocks.productUpdate },
  },
}));
vi.mock("@saas/ozon", async (original) => ({
  ...await original<typeof import("@saas/ozon")>(), mockImportProducts: mocks.submit,
}));

import { submitDraft } from "./index";
const input = {
  tenantId: "tenant-1", productId: "product-1", draftId: "draft-1", storeId: "store-1",
  store: { ozonClientId: "mock-client", ozonApiKey: "mock-key" }, request: { items: [{ offer_id: "item-1" }] },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENABLE_REAL_OZON_SUBMIT", "false");
  mocks.claim.mockResolvedValue({ id: "publish-1" });
  mocks.debit.mockResolvedValue({ id: "credit-1" });
  mocks.submit.mockReturnValue({ task_id: 123 });
  mocks.runUpdate.mockResolvedValue({ id: "publish-1", ozonTaskId: "123", count: 1 });
});

it("claims atomically before charging or importing, and updates the same publish run", async () => {
  await expect(submitDraft(input)).resolves.toEqual({ publishRunId: "publish-1", ozonTaskId: "123" });
  expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1", draftId: "draft-1", storeId: "store-1", request: input.request }));
  expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.debit.mock.invocationCallOrder[0]!);
  expect(mocks.debit.mock.invocationCallOrder[0]).toBeLessThan(mocks.submit.mock.invocationCallOrder[0]!);
  expect(mocks.runUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "publish-1", tenantId: "tenant-1" }, data: expect.objectContaining({ status: "submitted", ozonTaskId: "123" }) }));
});

it("does not charge or import when another publisher already owns the hash", async () => {
  mocks.claim.mockRejectedValue(new Error("duplicate_submission"));
  await expect(submitDraft(input)).rejects.toThrow("duplicate_submission");
  expect(mocks.debit).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("keeps an uncertain import claimed and never refunds or marks it definitely failed", async () => {
  mocks.submit.mockImplementation(() => { throw new Error("connection lost after send"); });
  await expect(submitDraft(input)).rejects.toThrow("result_pending_verification");
  expect(mocks.debit).toHaveBeenCalledTimes(1);
  expect(mocks.runUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending_verification" }) }));
  expect(mocks.draftUpdate.mock.calls.every(([arg]) => arg.data.status !== "FAILED")).toBe(true);
});

it("preserves the accepted task when later bookkeeping fails", async () => {
  mocks.draftUpdate.mockRejectedValueOnce(new Error("write failed"));
  await expect(submitDraft(input)).rejects.toThrow("result_pending_verification");
  expect(mocks.debit).toHaveBeenCalledTimes(1);
  expect(mocks.runUpdate.mock.calls.every(([arg]) => arg.data.status === "submitted")).toBe(true);
  expect(mocks.runUpdate.mock.calls.at(-1)?.[0].data.ozonTaskId).toBe("123");
});
