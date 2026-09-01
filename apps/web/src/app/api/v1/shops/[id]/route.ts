import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, unauthorized, forbidden, notFound } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const shop = await prisma.sourceShop.findFirst({
    where: { tenantId, id: params.id },
    include: {
      supplier: true,
      syncRuns: { orderBy: { startedAt: "desc" }, take: 20 },
      snapshots: { orderBy: { lastSeenAt: "desc" }, take: 200 },
    },
  });
  if (!shop) return notFound("店铺不存在");

  const newCount = await prisma.shopProductSnapshot.count({
    where: { tenantId, shopId: shop.id, followStatus: "NEW" },
  });

  return ok({ shop, newCount });
}