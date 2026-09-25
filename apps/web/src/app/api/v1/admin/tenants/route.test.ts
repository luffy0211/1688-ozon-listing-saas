import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  transaction: vi.fn(),
  tenantCreate: vi.fn(),
  inviteCreate: vi.fn(),
  creditCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/request-session", () => ({ sessionFromRequest: mocks.session }));
vi.mock("@saas/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    tenant: { create: mocks.tenantCreate },
    invite: { create: mocks.inviteCreate },
    creditAccount: { create: mocks.creditCreate },
    auditLog: { create: mocks.auditCreate },
  },
}));

import { POST } from "./route";

function request(name: string) {
  return new Request("http://localhost/api/v1/admin/tenants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: "admin-1", role: "admin", tenantId: null });
  mocks.transaction.mockImplementation(async (callback) => callback({
    tenant: { create: mocks.tenantCreate },
    invite: { create: mocks.inviteCreate },
    creditAccount: { create: mocks.creditCreate },
    auditLog: { create: mocks.auditCreate },
  }));
  mocks.tenantCreate.mockResolvedValue({ id: "tenant-2", name: "客户乙" });
  mocks.inviteCreate.mockImplementation(async ({ data }) => ({ code: data.code }));
});

describe("POST admin tenants", () => {
  it("blocks customer accounts", async () => {
    mocks.session.mockResolvedValue({ userId: "user-1", role: "owner", tenantId: "tenant-1" });
    expect((await POST(request("客户乙"))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("creates an isolated tenant, zero balance, and one-use owner invite", async () => {
    const response = await POST(request("  客户乙  "));
    expect(response.status).toBe(201);
    expect(mocks.tenantCreate).toHaveBeenCalledWith({ data: { name: "客户乙" } });
    expect(mocks.creditCreate).toHaveBeenCalledWith({ data: { tenantId: "tenant-2", balance: 0 } });
    expect(mocks.inviteCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: "tenant-2", role: "owner", maxUses: 1, usedCount: 0, createdBy: "admin-1",
    }) });
    await expect(response.json()).resolves.toMatchObject({ data: { tenant: { id: "tenant-2" }, inviteCode: expect.any(String) } });
  });

  it("rejects invalid names before touching data", async () => {
    expect((await POST(request(" "))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
