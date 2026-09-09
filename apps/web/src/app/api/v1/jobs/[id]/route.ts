import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, unauthorized, forbidden, notFound } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const job = await prisma.listingJob.findFirst({
    where: { tenantId, id: params.id },
    include: {
      product: { select: { id: true, offerId: true, title: true } },
      store: { select: { id: true, name: true } },
      steps: { orderBy: { stepIndex: "asc" } },
      ozonDrafts: { include: { publishRuns: true } },
    },
  });
  if (!job) return notFound("任务不存在");

  return ok({ job });
}