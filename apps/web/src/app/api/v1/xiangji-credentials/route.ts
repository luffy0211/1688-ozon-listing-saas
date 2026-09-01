import type { NextRequest } from "next/server";
import { prisma, encryptSecret } from "@saas/db";
import { ok, fail, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const creds = await prisma.xiangjiCredential.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  return ok({
    credentials: creds.map((c) => ({
      id: c.id,
      name: c.name,
      apiKey: "****",
      createdAt: c.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const body = await req.json().catch(() => null);
  const apiKey: string | undefined = body?.apiKey?.trim();
  if (!apiKey) return fail("validation_error", "缺少 X-API-Key");

  const cred = await prisma.xiangjiCredential.create({
    data: {
      tenantId,
      name: body?.name ?? null,
      apiKey: encryptSecret(apiKey),
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.userId,
      action: "xiangji.configure",
      entityType: "xiangji_credential",
      entityId: cred.id,
    },
  });

  return ok({
    credential: { id: cred.id, name: cred.name, apiKey: "****", createdAt: cred.createdAt },
  });
}
