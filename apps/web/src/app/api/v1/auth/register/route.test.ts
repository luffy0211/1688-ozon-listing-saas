import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  inviteFind: vi.fn(),
  inviteClaim: vi.fn(),
  userFind: vi.fn(),
  userCount: vi.fn(),
  userCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@saas/db", () => ({ prisma: {
  $transaction: mocks.transaction,
  invite: { findUnique: mocks.inviteFind, updateMany: mocks.inviteClaim },
  user: { findUnique: mocks.userFind, count: mocks.userCount, create: mocks.userCreate },
  auditLog: { create: mocks.auditCreate },
} }));
vi.mock("@/lib/auth", () => ({
  hashPassword: () => "hash",
  signSession: async () => "session",
  SESSION_COOKIE: "session",
}));

import { POST } from "./route";

const request = () => new Request("http://localhost/api/v1/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "new@example.com", password: "password123", inviteCode: "one-time" }),
}) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback) => callback({
    invite: { findUnique: mocks.inviteFind, updateMany: mocks.inviteClaim },
    user: { findUnique: mocks.userFind, count: mocks.userCount, create: mocks.userCreate },
    auditLog: { create: mocks.auditCreate },
  }));
  mocks.inviteFind.mockResolvedValue({ id: "invite-1", tenantId: "customer-2", maxUses: 1, usedCount: 0, role: "owner", expiresAt: null });
  mocks.userFind.mockResolvedValue(null);
  mocks.userCount.mockResolvedValue(0);
  mocks.userCreate.mockResolvedValue({ id: "user-2", email: "new@example.com", name: null, role: "owner", tenantId: "customer-2" });
  mocks.inviteClaim.mockResolvedValue({ count: 1 });
});

describe("customer registration", () => {
  it("atomically claims the one-use invite before creating the tenant user", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.inviteClaim).toHaveBeenCalledWith({ where: { id: "invite-1", usedCount: { lt: 1 } }, data: { usedCount: { increment: 1 } } });
    expect(mocks.userCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: "customer-2", role: "owner" }) });
  });

  it("does not create a user when the invite was claimed concurrently", async () => {
    mocks.inviteClaim.mockResolvedValue({ count: 0 });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });
});
