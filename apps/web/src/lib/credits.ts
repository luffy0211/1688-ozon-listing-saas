import { CreditTransactionType, Prisma } from "@prisma/client";
import { prisma } from "@saas/db";

export type CreditAdjustmentMode = "grant" | "deduct";

export const CREDIT_USAGE_FEATURES = {
  store_diagnosis: {
    label: "店铺诊断",
    cost: 20,
  },
  competitor_analysis: {
    label: "竞品分析",
    cost: 50,
  },
  listing_publish: {
    label: "商品上架",
    cost: 30,
  },
  agent_message: {
    label: "Agent 对话",
    cost: 1,
  },
} as const;

export type CreditUsageFeature = keyof typeof CREDIT_USAGE_FEATURES;

export type CreditAdjustmentInput = {
  tenantId: string;
  mode: CreditAdjustmentMode;
  amount: number;
  reason?: string;
  createdBy?: string;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey?: string;
};

export type CreditUsageInput = {
  tenantId: string;
  feature: CreditUsageFeature;
  amount?: number;
  reason?: string;
  createdBy?: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
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
  validatePositiveAmount(amount);
  if (!reason) {
    throw new CreditAdjustmentError("validation_error", "请填写积分调整原因");
  }
  if (reason.length > 200) {
    throw new CreditAdjustmentError("validation_error", "原因不能超过 200 个字");
  }

  return {
    tenantId,
    mode,
    amount,
    reason,
    createdBy: typeof body?.createdBy === "string" ? body.createdBy : undefined,
    referenceType: typeof body?.referenceType === "string" ? body.referenceType : undefined,
    referenceId: typeof body?.referenceId === "string" ? body.referenceId : undefined,
    idempotencyKey: typeof body?.idempotencyKey === "string" ? body.idempotencyKey : undefined,
  };
}

export async function adjustTenantCredits(input: CreditAdjustmentInput) {
  const amount = input.amount;
  const delta = input.mode === "grant" ? amount : -amount;
  const type = input.mode === "grant"
    ? CreditTransactionType.ADMIN_GRANT
    : CreditTransactionType.ADMIN_DEDUCT;

  return writeCreditTransaction({
    tenantId: input.tenantId,
    type,
    delta,
    amount,
    reason: input.reason,
    createdBy: input.createdBy,
    referenceType: input.referenceType ?? "admin_manual_adjustment",
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function consumeTenantCredits(input: CreditUsageInput) {
  const amount = input.amount ?? CREDIT_USAGE_FEATURES[input.feature].cost;
  validateUsageInput(input, amount);

  return writeCreditTransaction({
    tenantId: input.tenantId,
    type: CreditTransactionType.USAGE_DEBIT,
    delta: -amount,
    amount,
    reason: input.reason ?? CREDIT_USAGE_FEATURES[input.feature].label,
    createdBy: input.createdBy,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function refundTenantCredits(input: CreditUsageInput) {
  const amount = input.amount ?? CREDIT_USAGE_FEATURES[input.feature].cost;
  validateUsageInput(input, amount);

  return writeCreditTransaction({
    tenantId: input.tenantId,
    type: CreditTransactionType.USAGE_REFUND,
    delta: amount,
    amount,
    reason: input.reason ?? `${CREDIT_USAGE_FEATURES[input.feature].label}失败退回`,
    createdBy: input.createdBy,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function getTenantCreditBalance(tenantId: string) {
  const account = await prisma.creditAccount.findUnique({
    where: { tenantId },
    select: { balance: true, updatedAt: true },
  });
  return {
    balance: account?.balance ?? 0,
    updatedAt: account?.updatedAt ?? null,
    features: getCreditFeatureCatalog(),
  };
}

export function getCreditFeatureCatalog() {
  return Object.entries(CREDIT_USAGE_FEATURES).map(([key, value]) => ({
    key,
    label: value.label,
    cost: value.cost,
  }));
}

function validateUsageInput(input: CreditUsageInput, amount: number) {
  validatePositiveAmount(amount);
  validateIdempotencyKey(input.idempotencyKey);
  if (!input.referenceType.trim() || !input.referenceId.trim()) {
    throw new CreditAdjustmentError("validation_error", "扣费必须绑定业务引用");
  }
}

async function writeCreditTransaction(input: {
  tenantId: string;
  type: CreditTransactionType;
  delta: number;
  amount: number;
  reason?: string;
  createdBy?: string;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey?: string;
}) {
  validatePositiveAmount(input.amount);
  if (input.idempotencyKey) validateIdempotencyKey(input.idempotencyKey);
  const idempotencyExpectation = {
    tenantId: input.tenantId,
    type: input.type,
    delta: input.delta,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
  };

  if (input.idempotencyKey) {
    const existing = await findExistingIdempotentTransaction(
      input.idempotencyKey,
      prisma,
      idempotencyExpectation,
    );
    if (existing) return existing;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.idempotencyKey}))`;
        const existing = await findExistingIdempotentTransaction(
          input.idempotencyKey,
          tx,
          idempotencyExpectation,
        );
        if (existing) return existing;
      }

      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { id: true },
      });
      if (!tenant) {
        throw new CreditAdjustmentError("tenant_not_found", "租户不存在", 404);
      }

      const account = await tx.creditAccount.upsert({
        where: { tenantId: input.tenantId },
        create: { tenantId: input.tenantId, balance: 0 },
        update: {},
      });
      const updatedAccount = input.delta > 0
        ? await tx.creditAccount.update({
            where: { id: account.id },
            data: { balance: { increment: input.amount } },
          })
        : await decrementCreditsIfAvailable(tx, account.id, input.amount);
      const transaction = await tx.creditTransaction.create({
        data: {
          tenantId: input.tenantId,
          accountId: account.id,
          type: input.type,
          delta: input.delta,
          balanceAfter: updatedAccount.balance,
          reason: input.reason,
          createdBy: input.createdBy,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          idempotencyKey: input.idempotencyKey,
        },
      });

      return { account: updatedAccount, transaction, idempotentReplay: false };
    });
  } catch (error) {
    if (input.idempotencyKey && isUniqueConflict(error)) {
      const existing = await findExistingIdempotentTransaction(
        input.idempotencyKey,
        prisma,
        idempotencyExpectation,
      );
      if (existing) return existing;
    }
    throw error;
  }
}

async function findExistingIdempotentTransaction(
  idempotencyKey: string,
  client: Pick<typeof prisma, "creditTransaction"> = prisma,
  expected?: {
    tenantId: string;
    type: CreditTransactionType;
    delta: number;
    referenceType?: string;
    referenceId?: string;
  },
) {
  const transaction = await client.creditTransaction.findUnique({
    where: { idempotencyKey },
    include: { account: true },
  });
  if (!transaction) return null;
  if (expected && (
    transaction.tenantId !== expected.tenantId ||
    transaction.type !== expected.type ||
    transaction.delta !== expected.delta ||
    (transaction.referenceType ?? undefined) !== expected.referenceType ||
    (transaction.referenceId ?? undefined) !== expected.referenceId
  )) {
    throw new CreditAdjustmentError("idempotency_conflict", "幂等键已被其他积分流水使用", 409);
  }
  return {
    account: transaction.account,
    transaction,
    idempotentReplay: true,
  };
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

function validatePositiveAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new CreditAdjustmentError("validation_error", "积分数量必须是正整数");
  }
  if (amount > 1_000_000) {
    throw new CreditAdjustmentError("validation_error", "单次调整不能超过 1,000,000 积分");
  }
}

function validateIdempotencyKey(idempotencyKey: string) {
  if (!idempotencyKey.trim()) {
    throw new CreditAdjustmentError("validation_error", "缺少幂等键");
  }
  if (idempotencyKey.length > 200) {
    throw new CreditAdjustmentError("validation_error", "幂等键不能超过 200 个字符");
  }
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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
