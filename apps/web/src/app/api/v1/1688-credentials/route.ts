import type { NextRequest } from "next/server";
import { parseCookieHeader, hasLoginCookies } from "@saas/1688";
import { prisma, encryptSecret } from "@saas/db";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

function serializeCredential(cred: {
  id: string;
  name: string | null;
  status: string;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: cred.id,
    name: cred.name,
    status: cred.status,
    lastVerifiedAt: cred.lastVerifiedAt,
    createdAt: cred.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const credentials = await prisma.source1688Credential.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  return ok({ credentials: credentials.map(serializeCredential) });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const name = String(body?.name || "手动粘贴 1688 登录态").trim();
  const cookieText = String(body?.cookie || body?.cookieHeader || "").trim();
  if (!cookieText) {
    return fail("validation_error", "请粘贴 1688 Cookie");
  }

  const cookies = parseCookieHeader(cookieText);
  const cookieCount = Object.keys(cookies).length;
  if (cookieCount === 0) {
    return fail("validation_error", "Cookie 格式不正确，请粘贴 name=value; name2=value2 格式");
  }

  const hasLoginMarkers = hasLoginCookies(cookies);
  const cred = await prisma.source1688Credential.create({
    data: {
      tenantId,
      name,
      cookieJson: encryptSecret(JSON.stringify(cookies)),
      status: "active",
      lastVerifiedAt: hasLoginMarkers ? new Date() : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.userId,
      action: "source1688.cookie.save",
      entityType: "source1688_credential",
      entityId: cred.id,
      metaJson: { cookieCount, hasLoginMarkers } as never,
    },
  });

  return ok({
    credential: serializeCredential(cred),
    cookieCount,
    hasLoginMarkers,
  });
}
