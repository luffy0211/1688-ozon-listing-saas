import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@saas/db";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

function canManageInvites(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();
  if (!canManageInvites(session.role)) return forbidden();

  const invites = await prisma.invite.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  return ok({ invites });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();
  if (!canManageInvites(session.role)) return forbidden();

  const body = await req.json().catch(() => null);
  const code = randomBytes(6).toString("hex"); // 12 位邀请码
  const role = body?.role === "admin" ? "operator" : body?.role ?? "operator";

  const invite = await prisma.invite.create({
    data: {
      tenantId,
      code,
      role,
      maxUses: body?.maxUses ?? 1,
      expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
      createdBy: session.userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.userId,
      action: "invite.create",
      entityType: "invite",
      entityId: invite.id,
    },
  });

  return ok({ invite });
}
