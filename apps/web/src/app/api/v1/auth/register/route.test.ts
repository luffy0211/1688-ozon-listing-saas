import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  inviteFind: vi.fn(),
  inviteClaim: vi.fn(),
  userFind: vi.fn(),
  userCount: vi.fn(),
  userCreate: vi.fn(),
  auditCreate: vi.fn(),
  secrets: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ assertProductionSecrets: mocks.secrets }));
vi.mock("bullmq", () => ({ RedisConnection: vi.fn() }));

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

const input = { email: "new@example.com", password: "password123", inviteCode: "one-time" };
const request = (body: unknown = input) => new Request("http://localhost/api/v1/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}) as never;

beforeEach(() => {
  vi.resetAllMocks();
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
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("customer registration", () => {
  it.each([null, { ...input, email: 123 }, { ...input, email: "bad" },
    { ...input, password: 123 }, { ...input, password: "p".repeat(1025) },
    { ...input, password: "short" }, { ...input, name: {} }, { ...input, name: "n".repeat(101) },
    { ...input, inviteCode: [] }, { ...input, inviteCode: "i".repeat(129) },
    { ...input, ignored: "x".repeat(20_000) },
  ])("validates bounded input before any database work: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.inviteFind).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("sets Secure only for production registrations", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/; Secure/i);
    vi.stubEnv("NODE_ENV", "development");
    expect((await POST(request())).headers.get("set-cookie")).not.toMatch(/; Secure/i);
  });

  it("checks runtime secrets before claiming invites or creating users", async () => {
    mocks.secrets.mockImplementation(() => { throw new Error("unsafe deployment details"); });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("unsafe deployment details");
    expect(mocks.inviteFind).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not expose database details in errors or logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.inviteFind.mockRejectedValue(new Error("private database connection details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database");
    expect(log.mock.calls.flat().map(String).join(" ")).not.toContain("private database");
  });

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
