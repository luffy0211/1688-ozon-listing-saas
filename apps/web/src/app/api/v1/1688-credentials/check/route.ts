import type { NextRequest } from "next/server";
import { prisma, encryptSecret } from "@saas/db";
import { exchangeCookies, hasLoginCookies, pollQrCode } from "@saas/1688";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

function asCookieRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const lgToken: string | undefined = body?.lgToken?.trim();
  if (!lgToken) return fail("validation_error", "缺少 lgToken");

  const qrCookies = asCookieRecord(body?.qrCookies);
  const qrCreatedAt = Number(body?.createdAt ?? 0);

  let result;
  try {
    result = await pollQrCode(lgToken, body?.adToken ?? "", qrCookies);
  } catch (e) {
    return fail(
      "upstream_error",
      e instanceof Error ? e.message : "轮询扫码状态失败",
      [],
      502,
    );
  }

  const ageMs = qrCreatedAt ? Date.now() - qrCreatedAt : null;
  console.log("1688 qr poll", {
    lgToken: lgToken.slice(0, 6),
    status: result.status,
    code: result.code,
    message: result.message,
    ageMs,
  });

  if (result.status === "pending" || result.status === "scanned") {
    return ok({
      status: result.status,
      code: result.code,
      message: result.message,
    });
  }

  if (result.status === "expired") {
    if (ageMs !== null && ageMs >= 0 && ageMs < 90_000) {
      return ok({
        status: "pending",
        code: result.code,
        message: result.message,
        ignoredEarlyExpired: true,
      });
    }
    return ok({
      status: "expired",
      code: result.code,
      message: result.message,
    });
  }

  const cookies = await exchangeCookies(result.url, qrCookies);
  if (!hasLoginCookies(cookies)) {
    return fail("upstream_error", "登录成功但未拿到有效 Cookie，请重试", [], 502);
  }

  const cred = await prisma.source1688Credential.create({
    data: {
      tenantId,
      name: body?.name?.trim() || null,
      cookieJson: encryptSecret(JSON.stringify(cookies)),
      status: "active",
      lastVerifiedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.userId,
      action: "1688.login",
      entityType: "source1688_credential",
      entityId: cred.id,
    },
  });

  return ok({
    status: "success",
    credentialId: cred.id,
    code: result.code,
    message: result.message,
  });
}
