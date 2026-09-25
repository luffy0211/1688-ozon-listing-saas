import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@saas/db";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, sourceProducts: true, listingJobs: true } },
    },
  });

  const failedJobs = await prisma.listingJob.count({
    where: { status: "FAILED" },
  });

  return ok({ tenants, failedJobs });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    return fail("validation_error", "客户名称需为 2-80 个字符");
  }

  try {
    const inviteCode = randomBytes(12).toString("hex");
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({ data: { name } });
      await tx.creditAccount.create({ data: { tenantId: created.id, balance: 0 } });
      await tx.invite.create({ data: {
        tenantId: created.id,
        code: inviteCode,
        role: "owner",
        maxUses: 1,
        usedCount: 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy: session.userId,
      } });
      await tx.auditLog.create({ data: {
        tenantId: created.id,
        userId: session.userId,
        action: "admin.tenant.create",
        entityType: "tenant",
        entityId: created.id,
      } });
      return created;
    });
    return ok({ tenant: { id: tenant.id, name: tenant.name }, inviteCode }, 201);
  } catch (error) {
    console.error("admin tenant creation failed", error);
    return fail("tenant_creation_failed", "创建客户失败，请重试", [], 500);
  }
}
