import type { NextRequest } from "next/server";
import { prisma } from "@saas/db";
import { ok, unauthorized, forbidden, notFound } from "@/lib/api";
import { sessionFromRequest } from "@/lib/request-session";
import { getListingQueue } from "@/lib/queue";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const tenantId = session.tenantId;
  if (!tenantId) return forbidden();

  const job = await prisma.listingJob.findFirst({
    where: { tenantId, id: params.id },
  });
  if (!job) return notFound("任务不存在");

  await prisma.listingJob.update({
    where: { id: job.id },
    data: { status: "PENDING", error: null },
  });

  await getListingQueue().add(
    "process-listing",
    { jobId: job.id, retry: true },
    { jobId: job.id },
  );

  return ok({ jobId: job.id });
}