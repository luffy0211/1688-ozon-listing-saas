import type { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE, type SessionPayload } from "./auth";

/**
 * Route Handler 里的会话提取：先看 cookie，再看 Authorization: Bearer。
 * 插件采集接口通过 Bearer token（即登录会话 JWT）认证。
 */
export async function sessionFromRequest(
  req: NextRequest,
): Promise<SessionPayload | null> {
  const cookieToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookieToken) {
    const s = await verifySession(cookieToken);
    if (s) return s;
  }
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return verifySession(auth.slice("Bearer ".length));
  }
  return null;
}

/** 业务接口必须要求非空 tenantId（admin 平台接口除外）。 */
export function tenantOf(session: SessionPayload | null): string | null {
  return session?.tenantId ?? null;
}
