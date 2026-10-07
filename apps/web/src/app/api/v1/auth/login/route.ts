import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, fail } from "@/lib/api";
import { signSession, verifyPassword, SESSION_COOKIE } from "@/lib/auth";
import { z } from "zod";
import { assertProductionSecrets } from "@/lib/env";
import { consumeLoginAttempt, readAuthBody } from "@/lib/auth-security";

const WEEK = 60 * 60 * 24 * 7;
const inputSchema = z.object({
  email: z.string().trim().max(254).email().toLowerCase(),
  password: z.string().min(1).max(1024),
  adminOnly: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = inputSchema.safeParse(await readAuthBody(req));
    if (!parsed.success) return fail("validation_error", "邮箱或密码格式无效");
    const { email, password, adminOnly } = parsed.data;
    assertProductionSecrets();
    const retryAfter = await consumeLoginAttempt(email);
    if (retryAfter > 0) {
      const response = fail("rate_limited", "登录尝试过于频繁，请稍后重试", [], 429);
      response.headers.set("Retry-After", String(retryAfter));
      return response;
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
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: WEEK,
    });
    return res;
  } catch {
    return fail("service_unavailable", "登录失败，请稍后重试", [], 503);
  }
}
