import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  creditTransaction: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
  },
  creditAccount: {
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@saas/db", () => ({ prisma }));

vi.mock("@prisma/client", () => ({
  CreditTransactionType: {
    ADMIN_GRANT: "ADMIN_GRANT",
    ADMIN_DEDUCT: "ADMIN_DEDUCT",
    USAGE_DEBIT: "USAGE_DEBIT",
    USAGE_REFUND: "USAGE_REFUND",
  },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

import { CreditAdjustmentError, consumeTenantCredits } from "./credits";

describe("credits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.creditTransaction.findUnique.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({ id: "tenant-1" });
    prisma.creditAccount.upsert.mockResolvedValue({ id: "account-1", tenantId: "tenant-1", balance: 10 });
    prisma.creditAccount.updateMany.mockResolvedValue({ count: 0 });
    prisma.creditAccount.findUnique.mockResolvedValue({ id: "account-1", tenantId: "tenant-1", balance: 10 });
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  });

  it("blocks usage debit when balance would become negative", async () => {
    await expect(
      consumeTenantCredits({
        tenantId: "tenant-1",
        feature: "competitor_analysis",
        referenceType: "agent_run_tool",
        referenceId: "run-1:analyze_ozon_competitors",
        idempotencyKey: "agent-tool:run-1:analyze_ozon_competitors",
      }),
    ).rejects.toMatchObject({
      code: "insufficient_credits",
      status: 409,
      message: "扣减后余额不能为负数",
    });

    expect(prisma.creditAccount.updateMany).toHaveBeenCalledWith({
      where: { id: "account-1", balance: { gte: 50 } },
      data: { balance: { decrement: 50 } },
    });
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
  });
});
