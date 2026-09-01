import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, unauthorized, forbidden } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const products = await prisma.sourceProduct.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      shop: { select: { shopName: true } },
      _count: { select: { listingJobs: true, ozonDrafts: true } },
    },
  });

  return ok({ products });
}
