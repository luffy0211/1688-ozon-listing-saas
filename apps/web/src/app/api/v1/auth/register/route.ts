import type { NextRequest } from "next/server";
import { prisma, type Role } from "@saas/db";
import { ok, fail } from "@/lib/api";
import { hashPassword, signSession, SESSION_COOKIE } from "@/lib/auth";

const WEEK = 60 * 60 * 24 * 7;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email: string | undefined = body?.email?.trim().toLowerCase();
    const password: string | undefined = body?.password;
    const name: string | undefined = body?.name;
    const inviteCode: string | undefined = body?.inviteCode?.trim();

    if (!email || !password) {
      return fail("validation_error", "缺少邮箱或密码");
    }
    if (password.length < 8) {
      return fail("validation_error", "密码至少 8 位");
    }
    if (!inviteCode) {
      return fail("validation_error", "缺少邀请码");
    }

    const invite = await prisma.invite.findUnique({ where: { code: inviteCode } });
    if (!invite) {
      return fail("invalid_invite", "邀请码不存在", [], 404);
    }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return fail("invalid_invite", "邀请码已过期");
    }
    if (invite.usedCount >= invite.maxUses) {
      return fail("invalid_invite", "邀请码已被使用完");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return fail("email_taken", "该邮箱已注册");
    }

    // 首个用户自动成为该租户的 owner，便于初始化配置
    const tenantUserCount = await prisma.user.count({
      where: { tenantId: invite.tenantId },
    });
    const role: Role = tenantUserCount === 0 ? "owner" : (invite.role as Role);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(password),
        name: name ?? null,
        tenantId: invite.tenantId,
        role,
      },
    });

    await prisma.invite.update({
      where: { id: invite.id },
      data: { usedCount: { increment: 1 } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: invite.tenantId,
        userId: user.id,
        action: "auth.register",
        entityType: "user",
        entityId: user.id,
      },
    });

    const token = await signSession({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    });

    const res = ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
      },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: WEEK,
    });
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败";
    return fail("service_unavailable", message, [], 503);
  }
}
