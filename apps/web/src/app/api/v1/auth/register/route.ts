import type { NextRequest } from "next/server";
import { prisma, type Role } from "@saas/db";
import { ok, fail } from "@/lib/api";
import { hashPassword, signSession, SESSION_COOKIE } from "@/lib/auth";
import { z } from "zod";
import { assertProductionSecrets } from "@/lib/env";
import { readAuthBody } from "@/lib/auth-security";

const WEEK = 60 * 60 * 24 * 7;
const inputSchema = z.object({
  email: z.string().trim().max(254).email().toLowerCase(),
  password: z.string().min(8).max(1024),
  name: z.string().trim().max(100).optional(),
  inviteCode: z.string().trim().min(1).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = inputSchema.safeParse(await readAuthBody(req));
    if (!parsed.success) return fail("validation_error", "注册信息格式无效，密码至少 8 位");
    const { email, password, name, inviteCode } = parsed.data;
    assertProductionSecrets();

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

    const user = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedCount: { lt: invite.maxUses } },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new Error("invite_claimed");

      // 首个用户自动成为该租户的 owner，便于初始化配置。
      const tenantUserCount = await tx.user.count({ where: { tenantId: invite.tenantId } });
      const role: Role = tenantUserCount === 0 ? "owner" : (invite.role as Role);
      const created = await tx.user.create({
        data: {
          email,
          passwordHash: hashPassword(password),
          name: name ?? null,
          tenantId: invite.tenantId,
          role,
        },
      });
      await tx.auditLog.create({ data: {
        tenantId: invite.tenantId,
        userId: created.id,
        action: "auth.register",
        entityType: "user",
        entityId: created.id,
      } });
      return created;
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
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: WEEK,
    });
    return res;
  } catch (error) {
    if (error instanceof Error && error.message === "invite_claimed") {
      return fail("invalid_invite", "邀请码已被使用完");
    }
    console.error("registration failed");
    return fail("service_unavailable", "注册失败，请稍后重试", [], 503);
  }
}
