import { prisma, decryptSecret } from "@saas/db";
import { toCookieRecord, type CookieRecord } from "@saas/1688";

/**
 * 取租户的 1688 登录态（解密 cookie）。
 * credentialId 缺省时取最新一条 active 凭证。
 */
export async function get1688Cookies(
  tenantId: string,
  credentialId?: string,
): Promise<{ credentialId: string; cookies: CookieRecord } | null> {
  let cred;
  if (credentialId) {
    cred = await prisma.source1688Credential.findFirst({
      where: { id: credentialId, tenantId },
    });
  } else {
    cred = await prisma.source1688Credential.findFirst({
      where: { tenantId, status: "active" },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!cred) return null;

  try {
    const cookies = JSON.parse(decryptSecret(cred.cookieJson));
    const record = Array.isArray(cookies)
      ? toCookieRecord(cookies)
      : (cookies as CookieRecord);
    return { credentialId: cred.id, cookies: record };
  } catch {
    return null;
  }
}
