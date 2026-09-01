import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const shops = await prisma.sourceShop.findMany({
    where: { tenantId },
    orderBy: { lastSeenAt: "desc" },
    include: { _count: { select: { snapshots: true, sourceProducts: true } } },
  });

  return ok({ shops });
}
