import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, notFound, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

/** 删除 1688 登录态。 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await sessionFromRequest(_req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const existing = await prisma.source1688Credential.findFirst({
    where: { id: params.id, tenantId },
  });
  if (!existing) return notFound("凭证不存在");

  await prisma.source1688Credential.delete({ where: { id: params.id } });
  return ok({ deleted: true });
}
