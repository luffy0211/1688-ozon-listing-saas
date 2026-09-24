import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, fail } from "@/lib/api";
import { signSession, verifyPassword, SESSION_COOKIE } from "@/lib/auth";

const WEEK = 60 * 60 * 24 * 7;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email: string | undefined = body?.email?.trim().toLowerCase();
    const password: string | undefined = body?.password;
    const adminOnly = body?.adminOnly === true;

    if (!email || !password) {
      return fail("validation_error", "缺少邮箱或密码");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return fail("invalid_credentials", "邮箱或密码错误", [], 401);
    }
    if (adminOnly && user.role !== "admin") {
      return fail("admin_required", "此账号不是管理者账号", [], 403);
    }

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
      sessionToken: token,
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: WEEK,
    });
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    return fail("service_unavailable", message, [], 503);
  }
}
