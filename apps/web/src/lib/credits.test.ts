import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  creditTransaction: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
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

import { consumeTenantCredits, refundTenantCredits } from "./credits";

describe("credits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.creditTransaction.findUnique.mockResolvedValue(null);
    prisma.creditTransaction.findMany.mockResolvedValue([]);
    prisma.tenant.findUnique.mockResolvedValue({ id: "tenant-1" });
    prisma.creditAccount.upsert.mockResolvedValue({ id: "account-1", tenantId: "tenant-1", balance: 10 });
    prisma.creditAccount.updateMany.mockResolvedValue({ count: 0 });
    prisma.creditAccount.findUnique.mockResolvedValue({ id: "account-1", tenantId: "tenant-1", balance: 10 });
    prisma.creditAccount.update.mockResolvedValue({ id: "account-1", tenantId: "tenant-1", balance: 60 });
    prisma.creditTransaction.create.mockImplementation(async ({ data }) => ({ id: "transaction-1", ...data }));
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

  it.each([
    [consumeTenantCredits, "USAGE_DEBIT", -1, 100],
    [refundTenantCredits, "USAGE_REFUND", 1, 50],
    [refundTenantCredits, "USAGE_REFUND", 1, 100],
  ] as const)("replays %s %s without writing a second category transaction", async (adjust, type, sign, amount) => {
    const input = {
      tenantId: "tenant-1", feature: "competitor_analysis" as const, amount,
      referenceType: "agent_run_tool", referenceId: "run-1:analyze_ozon_competitors",
      idempotencyKey: `${sign === 1 ? "refund:" : ""}USAGE_DEBIT:run-1:categories`,
    };
    const account = { id: "account-1", tenantId: "tenant-1", balance: 500 + sign * amount };
    const transaction = {
      id: "transaction-1", tenantId: input.tenantId, type, delta: sign * amount,
      referenceType: input.referenceType, referenceId: input.referenceId, account,
    };
    prisma.creditAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.creditAccount.findUnique.mockResolvedValue(account);
    prisma.creditAccount.update.mockResolvedValue(account);
    prisma.creditTransaction.create.mockResolvedValue(transaction);
    prisma.creditTransaction.findMany.mockResolvedValue([{
      ...transaction, id: "debit-1", type: "USAGE_DEBIT", delta: -100,
      idempotencyKey: "USAGE_DEBIT:run-1:categories",
    }]);
    expect(await adjust(input)).toMatchObject({ idempotentReplay: false });
    prisma.creditTransaction.findUnique.mockResolvedValue(transaction);
    expect(await adjust(input)).toMatchObject({ idempotentReplay: true });
    expect(prisma.creditTransaction.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({ delta: sign * amount, idempotencyKey: input.idempotencyKey }),
    });
    expect(sign === 1 ? prisma.creditAccount.update : prisma.creditAccount.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    { tenantId: "other-tenant" }, { amount: 100 }, { referenceId: "other-run" },
  ])("rejects refund idempotency reuse with different ownership or amount: %s", async (overrides) => {
    const input = {
      tenantId: "tenant-1", feature: "competitor_analysis" as const, amount: 50,
      referenceType: "agent_run_tool", referenceId: "run-1:analyze_ozon_competitors",
      idempotencyKey: "refund:run-1:categories",
    };
    prisma.creditTransaction.findUnique.mockResolvedValue({
      ...input, type: "USAGE_REFUND", delta: 50, account: { balance: 50 },
    });
    await expect(refundTenantCredits({ ...input, ...overrides })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(prisma.creditAccount.update).not.toHaveBeenCalled();
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
  });

  const usage = {
    tenantId: "tenant-1", feature: "competitor_analysis" as const, amount: 100,
    referenceType: "agent_run_tool", referenceId: "run-1:analyze_ozon_competitors",
    idempotencyKey: "debit:run-1",
  };
  const debit = {
    ...usage, id: "debit-1", type: "USAGE_DEBIT", delta: -100,
    account: { id: "account-1", tenantId: "tenant-1", balance: 400 },
  };
  const partial = {
    ...debit, id: "refund-1", type: "USAGE_REFUND", delta: 50,
    idempotencyKey: `refund:${usage.idempotencyKey}:empty-categories`,
  };
  const refund = { ...usage, idempotencyKey: `refund:${usage.idempotencyKey}` };

  it("rejects a refund with no matching original debit", async () => {
    await expect(refundTenantCredits(refund)).rejects.toMatchObject({ code: "refund_debit_not_found" });
    expect(prisma.creditAccount.update).not.toHaveBeenCalled();
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("does not attach a refund to another debit in the same business reference", async () => {
    prisma.creditTransaction.findMany.mockResolvedValue([{ ...debit, idempotencyKey: "another-debit" }]);
    await expect(refundTenantCredits(refund)).rejects.toMatchObject({ code: "refund_debit_not_found" });
    expect(prisma.creditAccount.update).not.toHaveBeenCalled();
  });

  it("rejects a full refund after a partial refund rather than minting credits", async () => {
    prisma.creditTransaction.findMany.mockResolvedValue([debit, partial]);
    await expect(refundTenantCredits(refund)).rejects.toMatchObject({ code: "refund_exceeds_debit" });
    expect(prisma.creditAccount.update).not.toHaveBeenCalled();
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("refunds only the outstanding amount, then rejects any additional refund key", async () => {
    prisma.creditTransaction.findMany.mockResolvedValue([debit, partial]);
    const remaining = await refundTenantCredits({ ...refund, amount: 50 });
    expect(remaining.transaction.delta).toBe(50);
    expect(prisma.creditTransaction.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: usage.tenantId, referenceType: usage.referenceType, referenceId: usage.referenceId,
        type: { in: ["USAGE_DEBIT", "USAGE_REFUND"] },
      },
    });
    prisma.creditTransaction.findMany.mockResolvedValue([debit, partial, remaining.transaction]);
    await expect(refundTenantCredits({ ...refund, amount: 1, idempotencyKey: `${refund.idempotencyKey}:extra` }))
      .rejects.toMatchObject({ code: "refund_exceeds_debit" });
    expect(prisma.creditAccount.update).toHaveBeenCalledTimes(1);
  });

  it("replays an existing refund after the debit has been fully refunded without writing again", async () => {
    prisma.creditTransaction.findUnique.mockResolvedValue(partial);
    prisma.creditTransaction.findMany.mockResolvedValue([
      debit, partial, { ...partial, id: "refund-2", idempotencyKey: refund.idempotencyKey },
    ]);
    expect(await refundTenantCredits({ ...refund, amount: 50, idempotencyKey: partial.idempotencyKey }))
      .toMatchObject({ idempotentReplay: true, transaction: { id: "refund-1" } });
    expect(prisma.creditAccount.update).not.toHaveBeenCalled();
  });

  it.each([50, 100])("rejects reusing an original debit after %s credits were refunded", async (amount) => {
    prisma.creditTransaction.findUnique.mockResolvedValue(debit);
    prisma.creditTransaction.findMany.mockResolvedValue([debit, { ...partial, delta: amount }]);
    await expect(consumeTenantCredits(usage)).rejects.toMatchObject({ code: "credit_debit_refunded" });
    expect(prisma.creditAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("does not borrow refund allowance from another debit sharing the reference", async () => {
    const secondDebit = { ...debit, id: "debit-2", idempotencyKey: `${debit.idempotencyKey}:next` };
    prisma.creditTransaction.findMany.mockResolvedValue([debit, { ...partial, delta: 100 }, secondDebit]);
    await expect(refundTenantCredits({ ...refund, amount: 1 })).rejects.toMatchObject({ code: "refund_exceeds_debit" });
    prisma.creditTransaction.findMany.mockResolvedValue([
      debit, secondDebit, { ...partial, delta: 100, idempotencyKey: `refund:${secondDebit.idempotencyKey}:failed` },
    ]);
    expect((await refundTenantCredits(refund)).transaction.delta).toBe(100);
    expect(prisma.creditAccount.update).toHaveBeenCalledTimes(1);
  });

  it.each(["debit:run-1:empty-categories", "debit"])("rejects a new debit key %s that would reassign existing refunds", async (idempotencyKey) => {
    prisma.creditTransaction.findMany.mockResolvedValue([debit]);
    prisma.creditAccount.updateMany.mockResolvedValue({ count: 1 });
    await expect(consumeTenantCredits({ ...usage, idempotencyKey })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(prisma.creditAccount.updateMany).not.toHaveBeenCalled();
  });

  it("serializes concurrent refunds with different keys against one debit", async () => {
    const ledger: Array<Record<string, unknown>> = [debit];
    let lockTail = Promise.resolve();
    const lockKeys: string[] = [];
    prisma.$transaction.mockImplementation(async (callback) => {
      let release = () => {};
      const tx = { ...prisma, $executeRaw: async (_sql: unknown, key: string) => {
        lockKeys.push(key);
        if (key.startsWith("credit-usage:")) {
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
        }
        return 0;
      } };
      try { return await callback(tx); } finally { release(); }
    });
    prisma.creditTransaction.findUnique.mockImplementation(async ({ where }) =>
      ledger.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null);
    prisma.creditTransaction.findMany.mockImplementation(async () => [...ledger]);
    prisma.creditTransaction.create.mockImplementation(async ({ data }) => {
      const transaction = { id: `transaction-${ledger.length}`, ...data };
      ledger.push(transaction);
      return transaction;
    });
    const outcomes = await Promise.allSettled([
      refundTenantCredits({ ...refund, amount: 75, idempotencyKey: `${refund.idempotencyKey}:a` }),
      refundTenantCredits({ ...refund, amount: 75, idempotencyKey: `${refund.idempotencyKey}:b` }),
    ]);
    expect(outcomes.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(outcomes.find((result) => result.status === "rejected"))
      .toMatchObject({ reason: { code: "refund_exceeds_debit" } });
    expect(prisma.creditAccount.update).toHaveBeenCalledTimes(1);
    const referenceLocks = lockKeys.filter((key) => key.startsWith("credit-usage:"));
    expect(referenceLocks).toHaveLength(2);
    expect(new Set(referenceLocks).size).toBe(1);
  });
});
