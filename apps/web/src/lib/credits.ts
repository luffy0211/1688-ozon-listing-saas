import { CreditTransactionType, type Prisma } from "@prisma/client";
import { prisma } from "@saas/db";

export type CreditAdjustmentMode = "grant" | "deduct";

export type CreditAdjustmentInput = {
  tenantId: string;
  mode: CreditAdjustmentMode;
  amount: number;
  reason?: string;
  createdBy?: string;
  referenceType?: string;
  referenceId?: string;
};

export class CreditAdjustmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function normalizeCreditAdjustment(input: unknown): CreditAdjustmentInput {
  const body = input as Partial<CreditAdjustmentInput> | null;
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  const mode = body?.mode === "deduct" ? "deduct" : body?.mode === "grant" ? "grant" : null;
  const amount = Number(body?.amount);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!tenantId) {
    throw new CreditAdjustmentError("validation_error", "请选择租户");
  }
  if (!mode) {
    throw new CreditAdjustmentError("validation_error", "请选择加积分或扣积分");
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new CreditAdjustmentError("validation_error", "积分数量必须是正整数");
  }
  if (amount > 1_000_000) {
    throw new CreditAdjustmentError("validation_error", "单次调整不能超过 1,000,000 积分");
  }
  if (reason.length > 200) {
    throw new CreditAdjustmentError("validation_error", "原因不能超过 200 个字");
  }

  return {
    tenantId,
    mode,
    amount,
    reason: reason || undefined,
    createdBy: typeof body?.createdBy === "string" ? body.createdBy : undefined,
    referenceType: typeof body?.referenceType === "string" ? body.referenceType : undefined,
    referenceId: typeof body?.referenceId === "string" ? body.referenceId : undefined,
  };
}

export async function adjustTenantCredits(input: CreditAdjustmentInput) {
  const delta = input.mode === "grant" ? input.amount : -input.amount;
  const type = input.mode === "grant"
    ? CreditTransactionType.ADMIN_GRANT
    : CreditTransactionType.ADMIN_DEDUCT;

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true },
  });
  if (!tenant) {
    throw new CreditAdjustmentError("tenant_not_found", "租户不存在", 404);
  }

  return prisma.$transaction(async (tx) => {
    const account = await tx.creditAccount.upsert({
      where: { tenantId: input.tenantId },
      create: { tenantId: input.tenantId, balance: 0 },
      update: {},
    });
    const updatedAccount = input.mode === "grant"
      ? await tx.creditAccount.update({
          where: { id: account.id },
          data: { balance: { increment: input.amount } },
        })
      : await decrementCreditsIfAvailable(tx, account.id, input.amount);
    const balanceAfter = updatedAccount.balance;
    const transaction = await tx.creditTransaction.create({
      data: {
        tenantId: input.tenantId,
        accountId: account.id,
        type,
        delta,
        balanceAfter,
        reason: input.reason,
        createdBy: input.createdBy,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    });

    return { account: updatedAccount, transaction };
  });
}

async function decrementCreditsIfAvailable(
  tx: Prisma.TransactionClient,
  accountId: string,
  amount: number,
) {
  const result = await tx.creditAccount.updateMany({
    where: {
      id: accountId,
      balance: { gte: amount },
    },
    data: {
      balance: { decrement: amount },
    },
  });
  if (result.count !== 1) {
    throw new CreditAdjustmentError("insufficient_credits", "扣减后余额不能为负数", 409);
  }

  const updatedAccount = await tx.creditAccount.findUnique({
    where: { id: accountId },
  });
  if (!updatedAccount) {
    throw new CreditAdjustmentError("credit_account_not_found", "积分账户不存在", 404);
  }
  return updatedAccount;
}

export async function getAdminCreditOverview() {
  const [tenants, transactions] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        creditAccount: true,
        _count: {
          select: { users: true, sourceProducts: true, listingJobs: true },
        },
      },
    }),
    prisma.creditTransaction.findMany({
      take: 80,
      orderBy: { createdAt: "desc" },
      include: {
        tenant: { select: { id: true, name: true } },
      },
    }),
  ]);

  return { tenants, transactions };
}
