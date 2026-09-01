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

  const product = await prisma.sourceProduct.findFirst({
    where: { tenantId, id: params.id },
    include: {
      shop: true,
      productFacts: true,
      productAssets: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
      translationTasks: { orderBy: { createdAt: "desc" } },
      xiangjiTasks: { orderBy: { createdAt: "desc" } },
      ozonDrafts: { orderBy: { createdAt: "desc" } },
      listingJobs: {
        orderBy: { createdAt: "desc" },
        include: { steps: { orderBy: { stepIndex: "asc" } }, ozonDrafts: true },
      },
    },
  });
  if (!product) return notFound("商品不存在");

  return ok({ product });
}
