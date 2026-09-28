import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), consume: vi.fn(), refund: vi.fn(), submit: vi.fn(),
  prisma: {
    ozonDraft: { findFirst: vi.fn(), update: vi.fn() },
    sourceProduct: { update: vi.fn() },
    publishRun: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    xiangjiCredential: { count: vi.fn() },
  },
}));
vi.mock("@saas/db", () => ({ prisma: mocks.prisma, decryptSecret: () => "test-secret" }));
vi.mock("@/lib/request-session", () => ({ sessionFromRequest: mocks.session }));
vi.mock("@/lib/credits", () => ({
  consumeTenantCredits: mocks.consume, refundTenantCredits: mocks.refund,
  CreditAdjustmentError: class extends Error {},
}));
vi.mock("@saas/ozon", () => ({
  computeRequestHash: () => "hash", checkSubmitGuards: () => ({ ok: true }),
  mockImportProducts: mocks.submit,
  OzonClient: class { importProducts = mocks.submit; },
  OzonApiError: class extends Error { status = 400; },
}));
import { POST } from "./route";

const request = () => POST({} as NextRequest, { params: Promise.resolve({ id: "draft" }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENABLE_REAL_OZON_SUBMIT", "true");
  mocks.session.mockResolvedValue({ tenantId: "tenant", userId: "user" });
  mocks.prisma.ozonDraft.findFirst.mockResolvedValue({
    id: "draft", tenantId: "tenant", productId: "product", storeId: "store", status: "COMPILED",
    store: { tenantId: "tenant", ozonClientId: "client", ozonApiKey: "encrypted" },
    product: { tenantId: "tenant", offerId: "offer", productAssets: [{ kind: "main_image" }, { kind: "detail_image" }] },
    payloadJson: { items: [{ offer_id: "offer", price: "100" }] },
  });
  mocks.prisma.publishRun.findUnique.mockResolvedValue(null);
  mocks.prisma.publishRun.create.mockResolvedValue({ id: "run" });
  mocks.prisma.publishRun.update.mockResolvedValue({ id: "run", ozonTaskId: "42" });
  mocks.prisma.xiangjiCredential.count.mockResolvedValue(1);
  mocks.consume.mockResolvedValue({});
  mocks.refund.mockResolvedValue({});
  mocks.submit.mockResolvedValue({ task_id: 42 });
});
afterEach(() => vi.unstubAllEnvs());

describe("publish submission ownership", () => {
  it.each([
    [{ offer_id: "wrong", price: "100" }],
    [{ offer_id: "offer", price: "100" }, { offer_id: "other", price: "100" }],
  ])("rejects out-of-scope payloads before charging", async (...items) => {
    const draft = await mocks.prisma.ozonDraft.findFirst();
    mocks.prisma.ozonDraft.findFirst.mockResolvedValue({ ...draft, payloadJson: { items } });
    expect((await request()).status).toBe(422);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.prisma.publishRun.create).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant related store", async () => {
    const draft = await mocks.prisma.ozonDraft.findFirst();
    mocks.prisma.ozonDraft.findFirst.mockResolvedValue({ ...draft, store: { ...draft.store, tenantId: "other" } });
    expect((await request()).status).toBe(403);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("claims the unique request before charging or sending", async () => {
    mocks.consume.mockImplementation(async () => {
      expect(mocks.prisma.publishRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "submitting" }) });
    });
    expect((await request()).status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.publishRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run", tenantId: "tenant" }, data: expect.objectContaining({ status: "submitted" }),
    }));
  });

  it("does not charge, refund or submit a concurrent duplicate", async () => {
    mocks.prisma.publishRun.create.mockRejectedValue({ code: "P2002" });
    expect((await request()).status).toBe(409);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("retains an uncertain submission without refunding or declaring failure", async () => {
    mocks.submit.mockRejectedValue(new TypeError("fetch failed"));
    const response = await request();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ data: { publishRunId: "run", status: "pending_verification" } });
    expect(mocks.prisma.publishRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending_verification" }) }));
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.prisma.publishRun.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.ozonDraft.update).not.toHaveBeenCalled();
  });

  it("does not refund a submitted task if saving the final draft state fails", async () => {
    mocks.prisma.ozonDraft.update.mockRejectedValue(new Error("database unavailable"));
    expect((await request()).status).toBe(202);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("releases a claim on credit failure before any submission", async () => {
    mocks.consume.mockRejectedValue(new Error("credit database unavailable"));
    await expect(request()).rejects.toThrow("credit database unavailable");
    expect(mocks.prisma.publishRun.deleteMany).toHaveBeenCalledWith({ where: { id: "run", tenantId: "tenant", status: "submitting" } });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
